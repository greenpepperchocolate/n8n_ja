import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	LINE_MONTHLY_QUOTA_ERROR_DESCRIPTION,
	LINE_MONTHLY_QUOTA_ERROR_MESSAGE,
	LINE_MONTHLY_QUOTA_ERROR_TYPE,
	LineMonthlyQuotaExceededError,
} from '../helpers/errors';
import * as message from './message';
import type { LineMessagingType } from './node.type';
import * as user from './user';

function monthlyQuotaErrorItem(
	error: LineMonthlyQuotaExceededError,
	itemIndex: number,
): INodeExecutionData {
	return {
		json: {
			success: false,
			lineError: {
				type: LINE_MONTHLY_QUOTA_ERROR_TYPE,
				message: LINE_MONTHLY_QUOTA_ERROR_MESSAGE,
				description: LINE_MONTHLY_QUOTA_ERROR_DESCRIPTION,
				httpCode: 429,
				retryable: false,
				timestamp: new Date(error.timestamp).toISOString(),
			},
		},
		pairedItem: { item: itemIndex },
	};
}

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
			if (error instanceof LineMonthlyQuotaExceededError) {
				this.addExecutionHints({
					type: 'danger',
					location: 'outputPane',
					message: `${LINE_MONTHLY_QUOTA_ERROR_MESSAGE}。${LINE_MONTHLY_QUOTA_ERROR_DESCRIPTION}`,
				});

				for (let failedItemIndex = i; failedItemIndex < items.length; failedItemIndex++) {
					returnData.push(monthlyQuotaErrorItem(error, failedItemIndex));
				}

				break;
			}

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
