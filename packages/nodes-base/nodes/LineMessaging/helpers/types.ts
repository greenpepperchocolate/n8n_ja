import type { IDataObject } from 'n8n-workflow';

/**
 * Types for the subset of the LINE Messaging API this node covers.
 * https://developers.line.biz/en/reference/messaging-api/
 *
 * These are declared as type aliases rather than interfaces on purpose: only aliases get an
 * implicit index signature, which lets them be passed straight into the n8n request and output
 * helpers without an `as unknown as IDataObject` cast.
 */

/** Message types the API accepts. Only `text` is built today, the rest are the extension points. */
export type LineMessageType =
	| 'text'
	| 'image'
	| 'video'
	| 'audio'
	| 'location'
	| 'sticker'
	| 'template'
	| 'flex';

export type LineTextMessage = {
	type: 'text';
	text: string;
};

/** Union grows as more message types are implemented in `message-builder.ts`. */
export type LineMessage = LineTextMessage;

export type LineReplyBody = {
	replyToken: string;
	messages: LineMessage[];
	notificationDisabled?: boolean;
};

export type LinePushBody = {
	to: string;
	messages: LineMessage[];
	notificationDisabled?: boolean;
};

export type LineMulticastBody = {
	to: string[];
	messages: LineMessage[];
	notificationDisabled?: boolean;
};

export type LineBroadcastBody = {
	messages: LineMessage[];
	notificationDisabled?: boolean;
};

export type LineUserProfile = {
	userId: string;
	displayName: string;
	pictureUrl?: string;
	statusMessage?: string;
	language?: string;
};

/** Error body returned by the Messaging API. */
export interface LineApiErrorDetail {
	message?: string;
	property?: string;
}

export interface LineApiErrorBody {
	message?: string;
	details?: LineApiErrorDetail[];
}

/** Webhook event types LINE can deliver. */
export type LineWebhookEventType =
	| 'message'
	| 'follow'
	| 'unfollow'
	| 'join'
	| 'leave'
	| 'memberJoined'
	| 'memberLeft'
	| 'postback'
	| 'videoPlayComplete'
	| 'beacon'
	| 'accountLink'
	| 'things'
	| 'unsend';

export type LineWebhookEvent = IDataObject & {
	type: string;
	timestamp?: number;
	mode?: string;
	webhookEventId?: string;
	replyToken?: string;
	source?: {
		type?: string;
		userId?: string;
		groupId?: string;
		roomId?: string;
	};
};

export type LineWebhookBody = {
	destination?: string;
	events?: LineWebhookEvent[];
};
