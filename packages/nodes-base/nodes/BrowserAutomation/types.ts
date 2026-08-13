import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

export type BrowserStepOperation =
	| 'openUrl'
	| 'fill'
	| 'click'
	| 'selectOption'
	| 'check'
	| 'uncheck'
	| 'wait'
	| 'getText'
	| 'getAttribute'
	| 'uploadFile'
	| 'screenshot';

export type BrowserLocatorType =
	| 'role'
	| 'label'
	| 'placeholder'
	| 'text'
	| 'testId'
	| 'css'
	| 'xpath';

export type BrowserFrameType = 'none' | 'name' | 'url' | 'css';

export interface BrowserFrameDefinition {
	type: BrowserFrameType;
	value?: string;
}

export interface BrowserLocatorDefinition {
	type: BrowserLocatorType;
	value?: string;
	role?: string;
	name?: string;
	frame?: BrowserFrameDefinition;
}

export interface BrowserStep extends IDataObject {
	operation: BrowserStepOperation;
	locatorType?: BrowserLocatorType;
	locatorValue?: string;
	locatorRole?: string;
	locatorName?: string;
	frameType?: BrowserFrameType;
	frameValue?: string;
	retry?: boolean;
	maxRetries?: number;
	retryDelay?: number;
}

export interface BrowserSettings {
	headless: boolean;
	browserTimeout: number;
	navigationTimeout: number;
	viewportWidth: number;
	viewportHeight: number;
	userAgent?: string;
	locale: string;
	timezone?: string;
	ignoreHttpsErrors: boolean;
	allowPrivateNetwork: boolean;
	maxUploadSizeMb: number;
}

export type BrowserErrorType =
	| 'ELEMENT_NOT_FOUND'
	| 'ELEMENT_MULTIPLE_MATCH'
	| 'ELEMENT_NOT_VISIBLE'
	| 'ELEMENT_DISABLED'
	| 'ELEMENT_NOT_CLICKABLE'
	| 'ELEMENT_OBSCURED'
	| 'FILL_NOT_SUPPORTED'
	| 'INVALID_LOCATOR'
	| 'FRAME_NOT_FOUND'
	| 'FRAME_ELEMENT_NOT_FOUND'
	| 'NAVIGATION_TIMEOUT'
	| 'ELEMENT_TIMEOUT'
	| 'CLICK_TIMEOUT'
	| 'POPUP_TIMEOUT'
	| 'UPLOAD_FAILED'
	| 'SCREENSHOT_FAILED'
	| 'BROWSER_LAUNCH_FAILED'
	| 'BROWSER_CRASHED'
	| 'NETWORK_ERROR'
	| 'SSL_ERROR'
	| 'SECURITY_BLOCKED'
	| 'INVALID_INPUT'
	| 'UNKNOWN_ERROR';

export interface BrowserErrorOutput extends IDataObject {
	type: BrowserErrorType;
	step: number;
	operation: BrowserStepOperation;
	message: string;
	url: string;
	locator: IDataObject;
	frame: IDataObject;
	retryCount: number;
	timestamp: string;
	screenshotBinaryProperty?: string;
}

export interface BrowserDebugEntry extends IDataObject {
	step: number;
	operation: BrowserStepOperation;
	phase: 'start' | 'retry' | 'end';
	url: string;
	durationMs?: number;
	retryCount: number;
	locator?: IDataObject;
}

export interface BrowserItemResult {
	json: IDataObject;
	binary: INodeExecutionData['binary'];
	debug: BrowserDebugEntry[];
}
