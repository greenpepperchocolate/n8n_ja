import type { AllEntities } from 'n8n-workflow';

type NodeMap = {
	message: 'broadcast' | 'multicast' | 'push' | 'reply';
	user: 'getProfile';
};

export type LineMessagingType = AllEntities<NodeMap>;
