/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IShiryuAiService } from '../common/shiryuAiService.js';

const $ = DOM.$;

interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
}

export class ShiryuAiChatView extends ViewPane {

	static readonly ID = 'workbench.view.shiryuAiChat';

	private _container!: HTMLElement;
	private _modelSelect!: HTMLSelectElement;
	private _loadBtn!: HTMLElement;
	private _statusIndicator!: HTMLElement;
	private _messagesContainer!: HTMLElement;
	private _input!: HTMLTextAreaElement;
	private _sendBtn!: HTMLElement;
	private _busyIndicator!: HTMLElement;

	private readonly _disposables = new DisposableStore();
	private _messages: ChatMessage[] = [];
	private _cancellation: CancellationTokenSource | undefined;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IShiryuAiService private readonly _shiryuAiService: IShiryuAiService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
	) {
		super(options, keybindingService, contextMenuService, _configurationService,
			contextKeyService, viewDescriptorService, instantiationService,
			openerService, themeService, hoverService);

		this._disposables.add(this._shiryuAiService.onDidChangeAvailability(() => this._refreshStatus()));
		this._disposables.add(this._shiryuAiService.onDidChangeBusy(() => this._refreshStatus()));
	}

	//#region Render

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = DOM.append(container, $('.shiryu-ai-chat'));
		this._container.style.display = 'flex';
		this._container.style.flexDirection = 'column';
		this._container.style.height = '100%';

		// ── Header with model selector ──
		const header = DOM.append(this._container, $('.shiryu-ai-chat-header'));
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '8px';
		header.style.padding = '8px 12px';
		header.style.borderBottom = '1px solid var(--vscode-widget-border)';
		header.style.flexShrink = '0';

		const label = DOM.append(header, $('label'));
		label.textContent = localize('model', 'Model:');
		label.style.fontSize = '11px';
		label.style.color = 'var(--vscode-descriptionForeground)';
		label.style.flexShrink = '0';

		this._modelSelect = DOM.append(header, $('select')) as HTMLSelectElement;
		this._modelSelect.style.flex = '1';
		this._modelSelect.style.padding = '3px 6px';
		this._modelSelect.style.fontSize = '11px';
		this._modelSelect.style.background = 'var(--vscode-input-background)';
		this._modelSelect.style.color = 'var(--vscode-input-foreground)';
		this._modelSelect.style.border = '1px solid var(--vscode-input-border)';
		this._modelSelect.style.borderRadius = '3px';

		this._populateModelList();

		this._loadBtn = DOM.append(header, $('button'));
		this._loadBtn.textContent = localize('load', 'Load');
		this._loadBtn.style.padding = '3px 10px';
		this._loadBtn.style.fontSize = '11px';
		this._loadBtn.style.cursor = 'pointer';
		this._loadBtn.style.background = 'var(--vscode-button-background)';
		this._loadBtn.style.color = 'var(--vscode-button-foreground)';
		this._loadBtn.style.border = 'none';
		this._loadBtn.style.borderRadius = '3px';
		this._loadBtn.style.flexShrink = '0';

		this._disposables.add(DOM.addDisposableListener(this._loadBtn, DOM.EventType.CLICK, () => this._loadSelected()));

		this._statusIndicator = DOM.append(header, $('.shiryu-ai-chat-status'));
		this._statusIndicator.style.width = '8px';
		this._statusIndicator.style.height = '8px';
		this._statusIndicator.style.borderRadius = '50%';
		this._statusIndicator.style.flexShrink = '0';
		this._statusIndicator.style.background = 'var(--vscode-descriptionForeground)';

		// ── Messages area ──
		this._messagesContainer = DOM.append(this._container, $('.shiryu-ai-chat-messages'));
		this._messagesContainer.style.flex = '1';
		this._messagesContainer.style.overflowY = 'auto';
		this._messagesContainer.style.padding = '8px 12px';
		this._messagesContainer.style.display = 'flex';
		this._messagesContainer.style.flexDirection = 'column';
		this._messagesContainer.style.gap = '8px';

		this._showWelcome();

		// ── Busy indicator ──
		this._busyIndicator = DOM.append(this._container, $('.shiryu-ai-chat-busy'));
		this._busyIndicator.style.display = 'none';
		this._busyIndicator.style.padding = '4px 12px';
		this._busyIndicator.style.fontSize = '11px';
		this._busyIndicator.style.color = 'var(--vscode-charts-yellow)';
		this._busyIndicator.style.fontStyle = 'italic';
		this._busyIndicator.style.flexShrink = '0';

		// ── Input area ──
		const inputArea = DOM.append(this._container, $('.shiryu-ai-chat-input-area'));
		inputArea.style.display = 'flex';
		inputArea.style.gap = '6px';
		inputArea.style.padding = '8px 12px';
		inputArea.style.borderTop = '1px solid var(--vscode-widget-border)';
		inputArea.style.flexShrink = '0';
		inputArea.style.alignItems = 'flex-end';

		this._input = DOM.append(inputArea, $('textarea')) as HTMLTextAreaElement;
		this._input.placeholder = localize('askAnything', 'Ask Shiryu AI anything...');
		this._input.style.flex = '1';
		this._input.style.padding = '6px 8px';
		this._input.style.fontSize = '12px';
		this._input.style.fontFamily = 'inherit';
		this._input.style.background = 'var(--vscode-input-background)';
		this._input.style.color = 'var(--vscode-input-foreground)';
		this._input.style.border = '1px solid var(--vscode-input-border)';
		this._input.style.borderRadius = '3px';
		this._input.style.outline = 'none';
		this._input.style.resize = 'none';
		this._input.style.minHeight = '32px';
		this._input.style.maxHeight = '120px';
		this._input.rows = 1;

		// Auto-resize input
		this._disposables.add(DOM.addDisposableListener(this._input, DOM.EventType.INPUT, () => {
			this._input.style.height = 'auto';
			this._input.style.height = Math.min(this._input.scrollHeight, 120) + 'px';
		}));

		this._sendBtn = DOM.append(inputArea, $('button'));
		this._sendBtn.textContent = localize('send', 'Send');
		this._sendBtn.style.padding = '6px 16px';
		this._sendBtn.style.fontSize = '12px';
		this._sendBtn.style.cursor = 'pointer';
		this._sendBtn.style.background = 'var(--vscode-button-background)';
		this._sendBtn.style.color = 'var(--vscode-button-foreground)';
		this._sendBtn.style.border = 'none';
		this._sendBtn.style.borderRadius = '3px';
		this._sendBtn.style.fontWeight = 'bold';
		this._sendBtn.style.flexShrink = '0';
		this._sendBtn.style.alignSelf = 'flex-end';

		this._disposables.add(DOM.addDisposableListener(this._sendBtn, DOM.EventType.CLICK, () => this._sendMessage()));
		this._disposables.add(DOM.addDisposableListener(this._input, DOM.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
		}));

		this._refreshStatus();
	}

	private _showWelcome(): void {
		if (!this._messagesContainer) { return; }
		DOM.clearNode(this._messagesContainer);

		const welcome = DOM.append(this._messagesContainer, $('.shiryu-ai-welcome'));
		welcome.style.display = 'flex';
		welcome.style.flexDirection = 'column';
		welcome.style.alignItems = 'center';
		welcome.style.justifyContent = 'center';
		welcome.style.flex = '1';
		welcome.style.gap = '8px';
		welcome.style.padding = '24px';
		welcome.style.color = 'var(--vscode-descriptionForeground)';

		const icon = DOM.append(welcome, $('span'));
		icon.className = 'codicon codicon-robot';
		icon.style.fontSize = '32px';
		icon.style.opacity = '0.5';

		const title = DOM.append(welcome, $('h2'));
		title.textContent = localize('welcomeTitle', 'Shiryu AI Studio');
		title.style.fontSize = '18px';
		title.style.fontWeight = 'bold';
		title.style.margin = '4px 0';
		title.style.color = 'var(--vscode-foreground)';

		const subtitle = DOM.append(welcome, $('div'));
		subtitle.textContent = localize('welcomeSubtitle', 'Select a model and click Load to start');
		subtitle.style.fontSize = '12px';

		const hints = DOM.append(welcome, $('div'));
		hints.style.fontSize = '11px';
		hints.style.display = 'flex';
		hints.style.flexDirection = 'column';
		hints.style.gap = '4px';
		hints.style.marginTop = '12px';

		const hint1 = DOM.append(hints, $('div'));
		hint1.textContent = localize('hint1', 'Download models from Hugging Face using the Model Manager tab');
		const hint2 = DOM.append(hints, $('div'));
		hint2.textContent = localize('hint2', 'Choose a model in the dropdown above');
		const hint3 = DOM.append(hints, $('div'));
		hint3.textContent = localize('hint3', 'Click Load and start chatting');
	}

	//#endregion

	//#region Model List

	private _populateModelList(): void {
		DOM.clearNode(this._modelSelect);

		// Default "choose model" option
		const defaultOpt = document.createElement('option');
		defaultOpt.value = '';
		defaultOpt.textContent = localize('chooseModel', 'Choose a model...');
		this._modelSelect.appendChild(defaultOpt);

		// Scan models directory
		this._scanModelsDirectory().then(models => {
			for (const model of models) {
				const opt = document.createElement('option');
				opt.value = model.path;
				opt.textContent = `${model.name} (${this._formatSize(model.size)})`;
				this._modelSelect.appendChild(opt);
			}

			// Set current model if loaded
			const info = this._shiryuAiService.getModelInfo();
			if (info) {
				this._modelSelect.value = info.modelPath;
			} else {
				const configPath = this._configurationService.getValue<string>('shiryuAi.modelPath');
				if (configPath && models.some(m => m.path === configPath)) {
					this._modelSelect.value = configPath;
				}
			}

			if (models.length === 0) {
				const emptyOpt = document.createElement('option');
				emptyOpt.value = '';
				emptyOpt.textContent = localize('noModels', 'No models found — download one first');
				emptyOpt.disabled = true;
				this._modelSelect.appendChild(emptyOpt);
			}
		}).catch(() => {
			const errorOpt = document.createElement('option');
			errorOpt.value = '';
			errorOpt.textContent = localize('scanError', 'Could not scan models directory');
			errorOpt.disabled = true;
			this._modelSelect.appendChild(errorOpt);
		});
	}

	private async _scanModelsDirectory(): Promise<Array<{ path: string; name: string; size: number }>> {
		const downloadDir = this._configurationService.getValue<string>('shiryuAi.downloadDir') || '~/.shiryu-ai-studio/models';
		const results: Array<{ path: string; name: string; size: number }> = [];

		try {
			const stat = await this._fileService.resolve(URI.file(downloadDir));
			if (stat.children) {
				for (const child of stat.children) {
					if (child.name.endsWith('.gguf') && !child.name.startsWith('mmproj')) {
						const fileSize = child.size ?? 0;
						if (fileSize < 500_000_000) { continue; }
						results.push({
							path: child.resource.fsPath,
							name: child.name.replace('.gguf', ''),
							size: fileSize,
						});
					}
				}
			}
		} catch {
			// directory doesn't exist
		}

		return results;
	}

	private _formatSize(bytes: number): string {
		if (bytes < 1024) { return `${bytes} B`; }
		if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
		if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	//#endregion

	//#region Model Loading

	private _refreshStatus(): void {
		if (!this._statusIndicator || !this._loadBtn) { return; }

		const available = this._shiryuAiService.isAvailable;
		const busy = this._shiryuAiService.isBusy;

		if (busy) {
			this._statusIndicator.style.background = 'var(--vscode-charts-yellow)';
			this._loadBtn.textContent = localize('loadedGenerating', 'Generating...');
			this._setButtonBusy(this._loadBtn, true);
		} else if (available) {
			this._statusIndicator.style.background = 'var(--vscode-charts-green)';
			this._loadBtn.textContent = localize('loaded', 'Loaded');
			this._setButtonBusy(this._loadBtn, true);
			// Update model select
			const info = this._shiryuAiService.getModelInfo();
			if (info && this._modelSelect) {
				this._modelSelect.value = info.modelPath;
			}
		} else {
			this._statusIndicator.style.background = 'var(--vscode-descriptionForeground)';
			this._loadBtn.textContent = localize('load', 'Load');
			this._setButtonBusy(this._loadBtn, false);
		}
	}

	private async _loadSelected(): Promise<void> {
		const path = this._modelSelect?.value;
		if (!path) {
			this._addSystemMessage(localize('noModelSelected', 'No model selected. Choose one from the dropdown.'));
			return;
		}

		this._loadBtn.textContent = localize('loading', 'Loading...');
		this._statusIndicator.style.background = 'var(--vscode-charts-yellow)';
		this._setButtonBusy(this._loadBtn, true);

		try {
			await this._shiryuAiService.loadModel({
				modelPath: path,
				gpuLayers: this._configurationService.getValue<number>('shiryuAi.gpuLayers') ?? -1,
				temperature: this._configurationService.getValue<number>('shiryuAi.temperature') ?? 0.7,
				maxTokens: this._configurationService.getValue<number>('shiryuAi.maxTokens') ?? 2048,
			});
			this._statusIndicator.style.background = 'var(--vscode-charts-green)';
			this._loadBtn.textContent = localize('loaded', 'Loaded');
			const modelName = path.split('\\').pop() || path.split('/').pop() || path;
			this._addSystemMessage(localize('modelLoaded', 'Model "{0}" loaded and ready.', modelName));
			this._refreshMessages();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._statusIndicator.style.background = 'var(--vscode-errorForeground)';
			this._loadBtn.textContent = localize('load', 'Load');
			this._setButtonBusy(this._loadBtn, false);
			this._addSystemMessage(localize('loadFailed', 'Failed to load model: {0}', msg));
			this._refreshMessages();
		}
	}

	//#endregion

	//#region Chat

	private async _sendMessage(): Promise<void> {
		const text = this._input?.value.trim();
		if (!text) { return; }

		if (!this._shiryuAiService.isAvailable) {
			this._addSystemMessage(localize('noModel', 'No model loaded. Choose one from the dropdown and click Load.'));
			this._refreshMessages();
			return;
		}

		// Add user message
		this._addUserMessage(text);
		this._input.value = '';
		this._input.style.height = 'auto';
		this._refreshMessages();

		// Show busy
		this._busyIndicator.style.display = 'block';
		this._busyIndicator.textContent = localize('thinking', 'Thinking...');
		this._statusIndicator.style.background = 'var(--vscode-charts-yellow)';

		// Create assistant message placeholder
		const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
		this._messages.push(assistantMsg);

		this._cancellation?.cancel();
		this._cancellation = new CancellationTokenSource();

		try {
			const result = await this._shiryuAiService.sendPrompt(
				text,
				(token) => {
					assistantMsg.content += token;
					this._refreshMessages();
					// Auto-scroll
					if (this._messagesContainer) {
						this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
					}
				},
				this._cancellation.token,
			);

			this._logService.info(`[ShiryuAI] Response: ${result.tokenCount} tokens, ${result.tokensPerSecond.toFixed(1)} t/s`);

			// Add metadata footer
			const meta = `\n\n---\n*${result.tokenCount} tokens · ${result.tokensPerSecond.toFixed(1)} t/s · ${result.durationMs}ms*`;
			assistantMsg.content += meta;
			this._refreshMessages();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			assistantMsg.content = `**Error:** ${msg}`;
			this._refreshMessages();
		} finally {
			this._busyIndicator.style.display = 'none';
			this._statusIndicator.style.background = 'var(--vscode-charts-green)';
			this._cancellation = undefined;
		}
	}

	private _addUserMessage(text: string): void {
		this._messages.push({ role: 'user', content: text, timestamp: Date.now() });
	}

	private _addSystemMessage(text: string): void {
		this._messages.push({ role: 'system', content: text, timestamp: Date.now() });
	}

	private _refreshMessages(): void {
		if (!this._messagesContainer) { return; }
		DOM.clearNode(this._messagesContainer);

		if (this._messages.length === 0) {
			this._showWelcome();
			return;
		}

		for (const msg of this._messages) {
			const bubble = this._renderMessageBubble(msg);
			this._messagesContainer.appendChild(bubble);
		}
	}

	private _renderMessageBubble(msg: ChatMessage): HTMLElement {
		const bubble = $('.shiryu-ai-chat-bubble');
		bubble.style.display = 'flex';
		bubble.style.flexDirection = 'column';
		bubble.style.padding = '8px 10px';
		bubble.style.borderRadius = '6px';
		bubble.style.fontSize = '12px';
		bubble.style.lineHeight = '1.5';
		bubble.style.wordBreak = 'break-word';
		bubble.style.maxWidth = '100%';
		bubble.style.whiteSpace = 'pre-wrap';

		if (msg.role === 'user') {
			bubble.style.alignSelf = 'flex-end';
			bubble.style.background = 'var(--vscode-button-background)';
			bubble.style.color = 'var(--vscode-button-foreground)';
			bubble.style.marginLeft = '32px';
		} else if (msg.role === 'assistant') {
			bubble.style.alignSelf = 'flex-start';
			bubble.style.background = 'var(--vscode-editor-background)';
			bubble.style.color = 'var(--vscode-editor-foreground)';
			bubble.style.border = '1px solid var(--vscode-widget-border)';
			bubble.style.marginRight = '32px';
		} else {
			// system message
			bubble.style.alignSelf = 'center';
			bubble.style.background = 'transparent';
			bubble.style.color = 'var(--vscode-descriptionForeground)';
			bubble.style.fontStyle = 'italic';
			bubble.style.fontSize = '11px';
			bubble.style.padding = '4px 12px';
			bubble.style.maxWidth = '100%';
		}

		// Role label
		if (msg.role !== 'system') {
			const roleLabel = DOM.append(bubble, $('.shiryu-ai-chat-role'));
			roleLabel.textContent = msg.role === 'user' ? localize('you', 'You') : localize('shiryuAi', 'Shiryu AI');
			roleLabel.style.fontSize = '10px';
			roleLabel.style.fontWeight = 'bold';
			roleLabel.style.marginBottom = '2px';
			roleLabel.style.opacity = '0.7';
		}

		// Content — render markdown-like formatting
		const content = DOM.append(bubble, $('.shiryu-ai-chat-content'));
		content.textContent = msg.content;
		content.style.fontSize = msg.role === 'system' ? '11px' : '12px';

		return bubble;
	}

	//#endregion

	//#region Helpers

	private _setButtonBusy(btn: HTMLElement, busy: boolean): void {
		if (busy) {
			btn.style.opacity = '0.6';
			btn.style.pointerEvents = 'none';
		} else {
			btn.style.opacity = '1';
			btn.style.pointerEvents = 'auto';
		}
	}

	//#endregion

	override dispose(): void {
		this._cancellation?.cancel();
		this._disposables.dispose();
		super.dispose();
	}
}