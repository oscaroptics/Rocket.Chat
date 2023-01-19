import { css } from '@rocket.chat/css-in-js';
import { Box, Option, OptionContent, Icon } from '@rocket.chat/fuselage';
import { useTranslation, useEndpoint } from '@rocket.chat/ui-contexts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { VFC } from 'react';
import React from 'react';

type MatrixFederationRemoveServerListProps = {
	servers: Array<{ name: string; default: boolean; local: boolean }>;
};

// const removeMatrixServer = ({ serverName }) => new Promise((resolve) => setTimeout(resolve, 1000));

const showIconOnHover = css`
	i {
		visibility: hidden;
	}
	li:hover {
		i {
			visibility: visible;
		}
	}
`;

const MatrixFederationRemoveServerList: VFC<MatrixFederationRemoveServerListProps> = ({ servers }) => {
	const removeMatrixServer = useEndpoint('POST', '/v1/federation/removeServerByUser');

	const queryClient = useQueryClient();

	const { mutate: removeServer, isLoading: isRemovingServer } = useMutation(
		['federation/removeServerByUser'],
		(serverName: string) => removeMatrixServer({ serverName }),
		{ onSuccess: () => queryClient.invalidateQueries(['federation/listServersByUsers']) },
	);

	const t = useTranslation();

	return (
		<Box display='flex' flexDirection='column' className={[showIconOnHover]}>
			<Box is='h2' fontScale='p1' fontWeight='bolder'>
				{t('Servers')}
			</Box>
			{servers.map(({ name, default: isDefault }) => (
				<Option key={name}>
					<OptionContent>{name}</OptionContent>
					{!isDefault && (
						<Icon
							size='x16'
							color={isRemovingServer ? 'annotation' : 'danger'}
							name='cross'
							onClick={() => (isRemovingServer ? null : removeServer(name))}
						/>
					)}
				</Option>
			))}
		</Box>
	);
};

export default MatrixFederationRemoveServerList;