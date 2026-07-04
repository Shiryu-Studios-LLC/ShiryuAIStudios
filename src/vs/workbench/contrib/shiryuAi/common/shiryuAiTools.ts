/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

//#region Tool Definition

export interface IShiryuToolParameter {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'object' | 'array';
	description: string;
	required?: boolean;
	enum?: string[];
	default?: unknown;
}

export interface IShiryuToolDefinition {
	/** Unique tool name */
	name: string;
	/** Human-readable description */
	description: string;
	/** JSON Schema-style parameters */
	parameters: IShiryuToolParameter[];
	/** Which provider owns this tool */
	provider: string;
}

export interface IShiryuToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface IShiryuToolResult {
	id: string;
	name: string;
	success: boolean;
	result?: unknown;
	error?: string;
	/** For image results — base64 encoded */
	images?: string[];
	/** For file results — paths to output files */
	files?: string[];
}

//#endregion

//#region Tool Provider Interface

export const IShiryuToolService = createDecorator<IShiryuToolService>('shiryuToolService');

export interface IShiryuToolService {
	_serviceBrand: undefined;

	/** Emitted when a tool call starts/finishes */
	readonly onDidChangeBusy: Event<boolean>;

	/** Whether a tool is currently executing */
	readonly isBusy: boolean;

	/** Register a tool provider */
	registerProvider(provider: IShiryuToolProvider): void;

	/** Get all available tools */
	getAvailableTools(): IShiryuToolDefinition[];

	/** Execute a tool call */
	executeTool(call: IShiryuToolCall, token: CancellationToken): Promise<IShiryuToolResult>;

	/** Execute multiple tool calls in parallel */
	executeTools(calls: IShiryuToolCall[], token: CancellationToken): Promise<IShiryuToolResult[]>;

	/** Generate the system prompt section for tool usage */
	generateToolPrompt(): string;

	/** Parse tool calls from model output */
	parseToolCalls(text: string): IShiryuToolCall[];
}

//#endregion

//#region Tool Provider Interface

export interface IShiryuToolProvider {
	/** Provider identifier */
	readonly id: string;
	/** Human-readable name */
	readonly name: string;

	/** Get tool definitions from this provider */
	getTools(): IShiryuToolDefinition[];

	/** Execute a tool call */
	execute(name: string, args: Record<string, unknown>, token: CancellationToken): Promise<IShiryuToolResult>;

	/** Check if this provider is available/connected */
	isAvailable(): Promise<boolean>;
}

//#endregion
