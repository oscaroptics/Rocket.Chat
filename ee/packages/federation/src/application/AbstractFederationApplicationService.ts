import type { IUser } from '@rocket.chat/core-typings';

import { FederatedUser } from '../domain/FederatedUser';
import type { IFederationBridge } from '../domain/IFederationBridge';
import type { RocketChatFileAdapter } from '../infrastructure/rocket-chat/adapters/File';
import type { RocketChatSettingsAdapter } from '../infrastructure/rocket-chat/adapters/Settings';
import type { RocketChatUserAdapter } from '../infrastructure/rocket-chat/adapters/User';
import type { IFederationInviteeDto } from './room/input/RoomSenderDto';

export abstract class AbstractFederationApplicationService {
	constructor(
		protected bridge: IFederationBridge,
		protected internalUserAdapter: RocketChatUserAdapter,
		protected internalFileAdapter: RocketChatFileAdapter,
		protected internalSettingsAdapter: RocketChatSettingsAdapter,
	) {}

	protected async createFederatedUserInternallyOnly(
		externalUserId: string,
		username: string,
		existsOnlyOnProxyServer = false,
		providedName?: string,
	): Promise<void> {
		const internalUser = await this.internalUserAdapter.getInternalUserByUsername(username);
		const externalUserProfileInformation = await this.bridge.getUserProfileInformation(externalUserId);
		let federatedUser;
		if (internalUser) {
			federatedUser = FederatedUser.createWithInternalReference(externalUserId, existsOnlyOnProxyServer, internalUser);
		} else {
			const name = externalUserProfileInformation?.displayName || providedName || username;
			federatedUser = FederatedUser.createInstance(externalUserId, {
				name,
				username,
				existsOnlyOnProxyServer,
			});
		}
		await this.internalUserAdapter.createFederatedUser(federatedUser);
		const insertedUser = await this.internalUserAdapter.getFederatedUserByExternalId(externalUserId);
		if (!insertedUser) {
			return;
		}
		await this.updateUserAvatarInternally(insertedUser, externalUserProfileInformation?.avatarUrl);
		await this.updateUserDisplayNameInternally(insertedUser, externalUserProfileInformation?.displayName);
	}

	protected async updateUserAvatarInternally(federatedUser: FederatedUser, avatarUrl?: string): Promise<void> {
		if (!avatarUrl) {
			return;
		}
		if (!federatedUser.isRemote()) {
			return;
		}
		if (federatedUser.shouldUpdateFederationAvatar(avatarUrl)) {
			await this.internalUserAdapter.setAvatar(federatedUser, this.bridge.convertMatrixUrlToHttp(federatedUser.getExternalId(), avatarUrl));
			await this.internalUserAdapter.updateFederationAvatar(federatedUser.getInternalId(), avatarUrl);
		}
	}

	protected async updateUserDisplayNameInternally(federatedUser: FederatedUser, displayName?: string): Promise<void> {
		if (!displayName) {
			return;
		}
		if (!federatedUser.isRemote()) {
			return;
		}
		if (federatedUser.shouldUpdateDisplayName(displayName)) {
			await this.internalUserAdapter.updateRealName(federatedUser.getInternalReference(), displayName);
		}
	}

	protected async createFederatedUserIncludingHomeserverUsingLocalInformation(internalInviterId: string): Promise<string> {
		const internalUser = await this.internalUserAdapter.getInternalUserById(internalInviterId);
		if (!internalUser?.username) {
			throw new Error(`Could not find user id for ${internalInviterId}`);
		}
		const name = internalUser.name || internalUser.username;
		const internalHomeServerDomain = await this.internalSettingsAdapter.getHomeServerDomain();
		const externalInviterId = await this.bridge.createUser(internalUser.username, name, internalHomeServerDomain);
		const existsOnlyOnProxyServer = true;
		await this.createFederatedUserInternallyOnly(externalInviterId, internalUser.username, existsOnlyOnProxyServer, name);
		await this.updateUserAvatarExternally(
			internalUser,
			(await this.internalUserAdapter.getFederatedUserByExternalId(externalInviterId)) as FederatedUser,
		);

		return externalInviterId;
	}

	protected async updateUserAvatarExternally(internalUser: IUser, externalInviter: FederatedUser): Promise<void> {
		if (!internalUser.username) {
			return;
		}
		const buffer = await this.internalFileAdapter.getBufferForAvatarFile(internalUser.username);
		if (!buffer) {
			return;
		}
		const avatarFileRecord = await this.internalFileAdapter.getFileMetadataForAvatarFile(internalUser.username);
		if (!avatarFileRecord?.type || !avatarFileRecord?.name) {
			return;
		}
		const externalFileUri = await this.bridge.uploadContent(externalInviter.getExternalId(), buffer, {
			type: avatarFileRecord.type,
			name: avatarFileRecord.name,
		});
		if (!externalFileUri) {
			return;
		}
		await this.internalUserAdapter.updateFederationAvatar(internalUser._id, externalFileUri);
		await this.bridge.setUserAvatar(externalInviter.getExternalId(), externalFileUri);
	}

	protected async createUsersLocallyOnly(invitees: IFederationInviteeDto[]): Promise<void> {
		const internalHomeserverDomain = await this.internalSettingsAdapter.getHomeServerDomain();
		const externalUsersToBeCreatedLocally = invitees.filter(
			(invitee) =>
				!FederatedUser.isOriginalFromTheProxyServer(
					this.bridge.extractHomeserverOrigin(invitee.rawInviteeId, internalHomeserverDomain),
					internalHomeserverDomain,
				),
		);

		for await (const invitee of externalUsersToBeCreatedLocally) {
			const externalUserProfileInformation = await this.bridge.getUserProfileInformation(invitee.rawInviteeId);

			const name = externalUserProfileInformation?.displayName || invitee.normalizedInviteeId;
			const username = invitee.normalizedInviteeId;
			const existsOnlyOnProxyServer = false;

			await this.internalUserAdapter.createLocalUser(
				FederatedUser.createLocalInstanceOnly({
					username,
					name,
					existsOnlyOnProxyServer,
				}),
			);

			const federatedUser = await this.internalUserAdapter.getFederatedUserByExternalId(invitee.rawInviteeId);
			if (!federatedUser) {
				return;
			}
			await this.updateUserAvatarInternally(federatedUser, externalUserProfileInformation?.avatarUrl);
			await this.updateUserDisplayNameInternally(federatedUser, externalUserProfileInformation?.displayName);
		}
	}
}
