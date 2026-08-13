import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import * as message from './message';
import type { LineMessagingType } from './node.type';
import * as user from './user';

/**
 * Dispatches to `actions/<resource>/<operation>.operation.ts`, one input item at a time so that
 * `continueOnFail` can isolate a single failing recipient from the rest of the batch.
 */
export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	const resource = this.getNodeParameter<LineMessagingType>('resource', 0);
	const operation = this.getNodeParameter('operation', 0);

	const lineMessaging = { resource, operation } as LineMessagingType;

	for (let i = 0; i < items.length; i++) {
		try {
			switch (lineMessaging.resource) {
				case 'message':
					returnData.push(...(await message[lineMessaging.operation].execute.call(this, i)));
					break;
				case 'user':
					returnData.push(...(await user[lineMessaging.operation].execute.call(this, i)));
					break;
				default:
					throw new NodeOperationError(
						this.getNode(),
						`The resource "${resource as string}" is not known`,
					);
			}
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (error as Error).message },
					pairedItem: { item: i },
				});
				continue;
			}
			throw error;
		}
	}

	return [returnData];
}
