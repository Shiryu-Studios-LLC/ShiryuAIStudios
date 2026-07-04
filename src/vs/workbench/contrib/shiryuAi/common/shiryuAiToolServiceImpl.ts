/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	IShiryuToolService, IShiryuToolProvider, IShiryuToolDefinition,
	IShiryuToolCall, IShiryuToolResult,
} from './shiryuAiTools.js';

let _toolCallIdCounter = 0;

export function generateToolCallId(): string {
	return `tool_call_${++_toolCallIdCounter}_${Date.now()}`;
}

export class ShiryuToolService extends Disposable implements IShiryuToolService {

	declare _serviceBrand: undefined;

	private readonly _providers = new Map<string, IShiryuToolProvider>();

	private readonly _onDidChangeBusy = new Emitter<boolean>();
	readonly onDidChangeBusy = this._onDidChangeBusy.event;

	private _busy = false;
	private _executingCount = 0;

	get isBusy(): boolean {
		return this._busy;
	}

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	override dispose(): void {
		this._onDidChangeBusy.dispose();
		super.dispose();
	}

	//#region Provider Management

	registerProvider(provider: IShiryuToolProvider): void {
		this._providers.set(provider.id, provider);
		this._logService.info(`[ShiryuAI/Tools] Registered provider: ${provider.name} (${provider.id})`);
	}

	//#endregion

	//#region Tool Discovery

	getAvailableTools(): IShiryuToolDefinition[] {
		const tools: IShiryuToolDefinition[] = [];
		for (const provider of this._providers.values()) {
			tools.push(...provider.getTools());
		}
		return tools;
	}

	//#endregion

	//#region Tool Execution

	async executeTool(call: IShiryuToolCall, token: CancellationToken): Promise<IShiryuToolResult> {
		const provider = this._findProviderForTool(call.name);
		if (!provider) {
			return {
				id: call.id,
				name: call.name,
				success: false,
				error: `No provider registered for tool: ${call.name}`,
			};
		}

		this._setBusy(true);
		try {
			this._logService.info(`[ShiryuAI/Tools] Executing: ${call.name}(${JSON.stringify(call.arguments).slice(0, 200)})`);
			const result = await provider.execute(call.name, call.arguments, token);
			this._logService.info(`[ShiryuAI/Tools] Completed: ${call.name} success=${result.success}`);
			return result;
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI/Tools] Failed: ${call.name} — ${error}`);
			return {
				id: call.id,
				name: call.name,
				success: false,
				error,
			};
		} finally {
			this._setBusy(false);
		}
	}

	async executeTools(calls: IShiryuToolCall[], token: CancellationToken): Promise<IShiryuToolResult[]> {
		const results: IShiryuToolResult[] = [];
		for (const call of calls) {
			if (token.isCancellationRequested) {
				break;
			}
			results.push(await this.executeTool(call, token));
		}
		return results;
	}

	//#endregion

	//#region Prompt Generation

	generateToolPrompt(): string {
		const tools = this.getAvailableTools();
		if (tools.length === 0) {
			return '';
		}

		const lines: string[] = [
			'## Available Tools',
			'',
			'You have access to the following tools. To use a tool, output a JSON block in your response:',
			'```tool',
			'{"tool": "tool_name", "arguments": {"param1": "value1"}}',
			'```',
			'',
			'You can call multiple tools in sequence. Wait for results before proceeding.',
			'',
		];

		for (const tool of tools) {
			lines.push(`### ${tool.name}`);
			lines.push(tool.description);
			lines.push('');
			lines.push('**Parameters:**');
			lines.push('| Name | Type | Required | Description |');
			lines.push('|------|------|----------|-------------|');
			for (const param of tool.parameters) {
				lines.push(`| \`${param.name}\` | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.description} |`);
			}
			lines.push('');
		}

		return lines.join('\n');
	}

	//#endregion

	//#region Parsing

	parseToolCalls(text: string): IShiryuToolCall[] {
		const calls: IShiryuToolCall[] = [];

		// Match ```tool ... ``` blocks
		const toolBlockRegex = /```tool\s*\n([\s\S]*?)\n\s*```/g;
		let match;

		while ((match = toolBlockRegex.exec(text)) !== null) {
			try {
				const parsed = JSON.parse(match[1].trim());
				if (parsed.tool && typeof parsed.tool === 'string') {
					calls.push({
						id: generateToolCallId(),
						name: parsed.tool,
						arguments: parsed.arguments || {},
					});
				}
			} catch {
				this._logService.warn(`[ShiryuAI/Tools] Failed to parse tool call: ${match[1].trim().slice(0, 100)}`);
			}
		}

		// Also match inline JSON tool calls: {"tool": "...", "arguments": {...}}
		const inlineRegex = /\{"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/g;
		while ((match = inlineRegex.exec(text)) !== null) {
			try {
				const toolName = match[1];
				const args = JSON.parse(match[2]);
				// Avoid duplicates
				if (!calls.some(c => c.name === toolName && JSON.stringify(c.arguments) === JSON.stringify(args))) {
					calls.push({
						id: generateToolCallId(),
						name: toolName,
						arguments: args,
					});
				}
			} catch {
				// ignore
			}
		}

		return calls;
	}

	//#endregion

	//#region Internal

	private _findProviderForTool(toolName: string): IShiryuToolProvider | undefined {
		for (const provider of this._providers.values()) {
			const tools = provider.getTools();
			if (tools.some(t => t.name === toolName)) {
				return provider;
			}
		}
		return undefined;
	}

	private _setBusy(busy: boolean): void {
		if (busy) {
			this._executingCount++;
			this._busy = true;
		} else {
			this._executingCount--;
			if (this._executingCount <= 0) {
				this._executingCount = 0;
				this._busy = false;
			}
		}
		this._onDidChangeBusy.fire(this._busy);
	}

	//#endregion
}
