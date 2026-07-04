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
import { HuggingFaceProvider } from '../common/shiryuAiHuggingFace.js';

const $ = DOM.$;

interface ModelEntry { path: string; name: string; size: number; }

export class ShiryuAiChatView extends ViewPane {

	static readonly ID = 'workbench.view.shiryuAiChat';

	private _container!: HTMLElement;
	private _messagesContainer!: HTMLElement;
	private _input!: HTMLTextAreaElement;
	private _sendBtn!: HTMLElement;

	// Input bar controls
	private _modelSelect!: HTMLSelectElement;
	private _modelStatus!: HTMLElement;
	private _hfBtn!: HTMLElement;

	private readonly _disposables = new DisposableStore();
	private readonly _hfProvider: HuggingFaceProvider;
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

		this._hfProvider = this._register(new HuggingFaceProvider(this._logService, this._fileService));
		this._register(this._shiryuAiService.onDidChangeAvailability(() => this._refreshModelStatus()));
		this._register(this._shiryuAiService.onDidChangeBusy(() => this._refreshModelStatus()));
	}

	//#region Render

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this._container = DOM.append(container, $('.shiryu-ai-chat'));
		this._container.style.display = 'flex';
		this._container.style.flexDirection = 'column';
		this._container.style.height = '100%';

		// Header bar
		const header = DOM.append(this._container, $('.shiryu-ai-header'));
		header.style.padding = '6px 12px';
		header.style.fontSize = '11px';
		header.style.color = 'var(--vscode-descriptionForeground)';
		header.style.borderBottom = '1px solid var(--vscode-widget-border)';
		header.style.flexShrink = '0';
		header.style.display = 'flex';
		header.style.justifyContent = 'space-between';
		header.style.alignItems = 'center';

		const title = DOM.append(header, $('span'));
		title.textContent = 'Shiryu AI Studio';
		title.style.fontWeight = 'bold';

		this._modelStatus = DOM.append(header, $('span'));
		this._modelStatus.textContent = '';
		this._modelStatus.style.fontSize = '10px';

		// Messages
		this._messagesContainer = DOM.append(this._container, $('.shiryu-ai-messages'));
		this._messagesContainer.style.flex = '1';
		this._messagesContainer.style.overflowY = 'auto';
		this._messagesContainer.style.padding = '12px';
		this._messagesContainer.style.fontSize = '13px';
		this._messagesContainer.style.lineHeight = '1.6';
		this._messagesContainer.style.whiteSpace = 'pre-wrap';
		this._messagesContainer.style.wordBreak = 'break-word';
		this._showWelcome();

		// Input bar
		const inputBar = DOM.append(this._container, $('.shiryu-ai-input-bar'));
		inputBar.style.display = 'flex';
		inputBar.style.flexDirection = 'column';
		inputBar.style.gap = '4px';
		inputBar.style.padding = '8px 12px';
		inputBar.style.borderTop = '1px solid var(--vscode-widget-border)';
		inputBar.style.flexShrink = '0';

		// Row 1: model selector + HF button
		const controlsRow = DOM.append(inputBar, $('.shiryu-ai-controls-row'));
		controlsRow.style.display = 'flex';
		controlsRow.style.gap = '6px';
		controlsRow.style.alignItems = 'center';

		this._modelSelect = DOM.append(controlsRow, $('select')) as HTMLSelectElement;
		this._modelSelect.style.flex = '1';
		this._modelSelect.style.padding = '3px 6px';
		this._modelSelect.style.fontSize = '11px';
		this._modelSelect.style.background = 'var(--vscode-input-background)';
		this._modelSelect.style.color = 'var(--vscode-input-foreground)';
		this._modelSelect.style.border = '1px solid var(--vscode-input-border)';
		this._modelSelect.style.borderRadius = '3px';
		this._populateModels();

		this._disposables.add(DOM.addDisposableListener(this._modelSelect, DOM.EventType.CHANGE, () => {
			this._onModelSelected();
		}));

		this._hfBtn = DOM.append(controlsRow, $('button'));
		this._hfBtn.textContent = localize('downloadModel', 'Download');
		this._hfBtn.style.padding = '3px 8px';
		this._hfBtn.style.fontSize = '10px';
		this._hfBtn.style.cursor = 'pointer';
		this._hfBtn.style.background = 'var(--vscode-button-secondaryBackground)';
		this._hfBtn.style.color = 'var(--vscode-button-secondaryForeground)';
		this._hfBtn.style.border = '1px solid var(--vscode-button-secondaryBorder)';
		this._hfBtn.style.borderRadius = '3px';
		this._hfBtn.style.whiteSpace = 'nowrap';
		this._hfBtn.title = localize('downloadModelTooltip', 'Search and download models from Hugging Face');

		this._disposables.add(DOM.addDisposableListener(this._hfBtn, DOM.EventType.CLICK, () => {
			this._showHfSearch();
		}));

		// Row 2: text input + send
		const inputRow = DOM.append(inputBar, $('.shiryu-ai-input-row'));
		inputRow.style.display = 'flex';
		inputRow.style.gap = '6px';
		inputRow.style.alignItems = 'flex-end';

		this._input = DOM.append(inputRow, $('textarea')) as HTMLTextAreaElement;
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
		this._input.style.minHeight = '30px';
		this._input.style.maxHeight = '100px';
		this._input.rows = 1;

		this._register(DOM.addDisposableListener(this._input, DOM.EventType.INPUT, () => {
			this._input.style.height = 'auto';
			this._input.style.height = Math.min(this._input.scrollHeight, 100) + 'px';
		}));

		this._sendBtn = DOM.append(inputRow, $('button'));
		this._sendBtn.textContent = localize('send', 'Send');
		this._sendBtn.style.padding = '5px 14px';
		this._sendBtn.style.fontSize = '12px';
		this._sendBtn.style.cursor = 'pointer';
		this._sendBtn.style.background = 'var(--vscode-button-background)';
		this._sendBtn.style.color = 'var(--vscode-button-foreground)';
		this._sendBtn.style.border = 'none';
		this._sendBtn.style.borderRadius = '3px';
		this._sendBtn.style.fontWeight = 'bold';
		this._sendBtn.style.whiteSpace = 'nowrap';

		this._register(DOM.addDisposableListener(this._sendBtn, DOM.EventType.CLICK, () => this._sendMessage()));
		this._register(DOM.addDisposableListener(this._input, DOM.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
		}));

		this._refreshModelStatus();
	}

	private _showWelcome(): void {
		this._messagesContainer.innerHTML = '';
		const w = DOM.append(this._messagesContainer, $('.shiryu-ai-welcome'));
		w.style.display = 'flex';
		w.style.flexDirection = 'column';
		w.style.alignItems = 'center';
		w.style.justifyContent = 'center';
		w.style.height = '100%';
		w.style.gap = '8px';
		w.style.color = 'var(--vscode-descriptionForeground)';
		w.style.textAlign = 'center';

		const icon = DOM.append(w, $('span'));
		icon.className = 'codicon codicon-robot';
		icon.style.fontSize = '28px';
		icon.style.opacity = '0.4';

		const t = DOM.append(w, $('div'));
		t.style.fontSize = '13px';
		t.textContent = localize('welcomePick', 'Select a model below to get started');
	}

	//#endregion

	//#region Model Management

	private _populateModels(): void {
		DOM.clearNode(this._modelSelect);
		const def = document.createElement('option');
		def.value = '';
		def.textContent = 'Select a model...';
		this._modelSelect.appendChild(def);

		this._scanModels().then(models => {
			if (models.length === 0) {
				const opt = document.createElement('option');
				opt.value = '';
				opt.textContent = 'No models — click Download';
				opt.disabled = true;
				this._modelSelect.appendChild(opt);
				return;
			}
			for (const m of models) {
				const opt = document.createElement('option');
				opt.value = m.path;
				opt.textContent = `${m.name} (${this._formatSize(m.size)})`;
				this._modelSelect.appendChild(opt);
			}
			const info = this._shiryuAiService.getModelInfo();
			if (info && models.some(m => m.path === info.modelPath)) {
				this._modelSelect.value = info.modelPath;
			}
		}).catch(() => {
			const opt = document.createElement('option');
			opt.value = '';
			opt.textContent = 'Cannot scan models';
			opt.disabled = true;
			this._modelSelect.appendChild(opt);
		});

		this._refreshModelStatus();
	}

	private async _scanModels(): Promise<ModelEntry[]> {
		const dir = this._configurationService.getValue<string>('shiryuAi.downloadDir') || '~/.shiryu-ai-studio/models';
		const entries: ModelEntry[] = [];
		try {
			const stat = await this._fileService.resolve(URI.file(dir));
			if (stat.children) {
				for (const c of stat.children) {
					if (c.name.endsWith('.gguf') && !c.name.startsWith('mmproj')) {
						const sz = c.size ?? 0;
						if (sz < 500_000_000) { continue; }
						entries.push({ path: c.resource.fsPath, name: c.name.replace('.gguf', ''), size: sz });
					}
				}
			}
		} catch { /* dir missing */ }
		return entries;
	}

	private async _onModelSelected(): Promise<void> {
		const path = this._modelSelect?.value;
		if (!path) { return; }

		// Auto-load — user just selects, we load
		this._setModelStatus('Loading...', 'yellow');
		try {
			await this._shiryuAiService.loadModel({
				modelPath: path,
				gpuLayers: this._configurationService.getValue<number>('shiryuAi.gpuLayers') ?? -1,
				temperature: this._configurationService.getValue<number>('shiryuAi.temperature') ?? 0.7,
				maxTokens: this._configurationService.getValue<number>('shiryuAi.maxTokens') ?? 2048,
			});
			const name = path.split('\\').pop() || path.split('/').pop() || path;
			this._setModelStatus(`${name} — Ready`, 'green');
			this._addMessage('system', `**Model loaded:** ${name}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._setModelStatus('Load failed', 'red');
			this._addMessage('error', `Failed to load model: ${msg}`);
		}
	}

	private _refreshModelStatus(): void {
		if (!this._modelStatus) { return; }
		const available = this._shiryuAiService.isAvailable;
		const busy = this._shiryuAiService.isBusy;
		const info = this._shiryuAiService.getModelInfo();

		if (busy) {
			this._setModelStatus('Generating...', 'yellow');
		} else if (available && info) {
			const name = info.modelPath.split('\\').pop() || info.modelPath.split('/').pop() || info.modelPath;
			this._setModelStatus(`${name} — Ready`, 'green');
		} else {
			this._setModelStatus('No model loaded', 'gray');
		}
	}

	private _setModelStatus(text: string, color: 'green' | 'yellow' | 'red' | 'gray'): void {
		if (!this._modelStatus) { return; }
		this._modelStatus.textContent = text;
		const colors: Record<string, string> = {
			green: 'var(--vscode-charts-green)',
			yellow: 'var(--vscode-charts-yellow)',
			red: 'var(--vscode-errorForeground)',
			gray: 'var(--vscode-descriptionForeground)',
		};
		this._modelStatus.style.color = colors[color];
	}

	private _formatSize(bytes: number): string {
		if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(0)} KB`; }
		if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	//#endregion

	//#region HuggingFace Download

	private async _showHfSearch(): Promise<void> {
		this._addMessage('system', 'Loading popular models from Hugging Face...');

		// Build a simple search UI inline
		const pop = document.createElement('div');
		pop.style.padding = '8px';
		pop.style.background = 'var(--vscode-editor-background)';
		pop.style.border = '1px solid var(--vscode-widget-border)';
		pop.style.borderRadius = '4px';
		pop.style.marginBottom = '8px';
		pop.style.maxHeight = '200px';
		pop.style.overflowY = 'auto';
		pop.style.fontSize = '11px';

		const popular = this._hfProvider.getPopularModels();
		for (const modelId of popular.slice(0, 8)) {
			const row = document.createElement('div');
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '6px';
			row.style.padding = '3px 6px';
			row.style.cursor = 'pointer';
			row.style.borderRadius = '3px';

			const name = document.createElement('span');
			name.textContent = modelId;
			name.style.flex = '1';
			name.style.overflow = 'hidden';
			name.style.textOverflow = 'ellipsis';
			name.style.whiteSpace = 'nowrap';
			row.appendChild(name);

			const btn = document.createElement('button');
			btn.textContent = 'Download';
			btn.style.padding = '2px 8px';
			btn.style.fontSize = '10px';
			btn.style.cursor = 'pointer';
			btn.style.background = 'var(--vscode-button-background)';
			btn.style.color = 'var(--vscode-button-foreground)';
			btn.style.border = 'none';
			btn.style.borderRadius = '2px';
			row.appendChild(btn);

			btn.addEventListener('click', (e) => { e.stopPropagation(); this._downloadModel(modelId); });
			row.addEventListener('click', () => { this._downloadModel(modelId); });
			pop.appendChild(row);
		}

		this._messagesContainer.insertBefore(pop, this._messagesContainer.firstChild);
	}

	private async _downloadModel(modelId: string): Promise<void> {
		this._addMessage('system', `Fetching files for **${modelId}**...`);
		const hfToken = this._configurationService.getValue<string>('shiryuAi.huggingFaceToken') || undefined;

		try {
			const detail = await this._hfProvider.getModelFiles(modelId, hfToken);
			if (detail.fileCount === 0) {
				this._addMessage('error', `No GGUF files found for ${modelId}. This model may be gated — set your HF token in settings.`);
				return;
			}

			// Pick smallest reasonable quant (Q4 or Q5)
			const sorted = detail.ggufFiles.sort((a, b) => a.size - b.size);
			const toDownload = sorted.find(f => f.path.includes('Q4_K_M') || f.path.includes('Q5_K_M')) || sorted[0];
			const downloadDir = this._configurationService.getValue<string>('shiryuAi.downloadDir') || '~/.shiryu-ai-studio/models';
			const dest = `${downloadDir}\\${toDownload.filename}`;

			this._addMessage('system', `Downloading **${toDownload.filename}** (${this._hfProvider.formatSize(toDownload.size)})...`);

			await this._hfProvider.downloadFile(modelId, toDownload.path, dest,
				(_bytes, _total, percent) => {
					// Update the last system message
					const last = this._messagesContainer.lastElementChild;
					if (last && last.classList.contains('system-msg')) {
						last.textContent = `Downloading **${toDownload.filename}**... ${percent}%`;
					}
				},
			);

			this._addMessage('system', `Downloaded **${toDownload.filename}**! Refresh the model list and select it above.`);

			// Refresh model list
			this._populateModels();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this._addMessage('error', `Download failed: ${msg}`);
		}
	}

	//#endregion

	//#region Chat

	private async _sendMessage(): Promise<void> {
		const text = this._input?.value.trim();
		if (!text) { return; }

		if (!this._shiryuAiService.isAvailable) {
			this._addMessage('error', 'No model loaded. Select one from the dropdown above.');
			return;
		}

		// Add user message
		this._addMessage('user', text);
		this._input.value = '';
		this._input.style.height = 'auto';

		// Thinking indicator
		const thinkEl = this._addMessage('assistant', '*Thinking...*');
		this._setModelStatus('Generating...', 'yellow');

		this._cancellation?.cancel();
		this._cancellation = new CancellationTokenSource();

		let fullResponse = '';
		try {
			const result = await this._shiryuAiService.sendPrompt(
				text,
				(token) => {
					fullResponse += token;
					thinkEl.textContent = fullResponse;
					this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
				},
				this._cancellation.token,
			);
			const meta = `\n\n*${result.tokenCount} tokens · ${result.tokensPerSecond.toFixed(1)} t/s*`;
			thinkEl.textContent = fullResponse + meta;
			this._setModelStatus('Ready', 'green');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			thinkEl.textContent = `**Error:** ${msg}`;
			thinkEl.style.color = 'var(--vscode-errorForeground)';
			this._setModelStatus('Error', 'red');
		} finally {
			this._cancellation = undefined;
			this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
		}
	}

	private _addMessage(role: 'user' | 'assistant' | 'system' | 'error', text: string): HTMLElement {
		if (!this._messagesContainer) { return document.createElement('div'); }

		// Remove welcome if present
		const welcome = this._messagesContainer.querySelector('.shiryu-ai-welcome');
		if (welcome) { welcome.remove(); }

		const el = DOM.append(this._messagesContainer, $('.shiryu-ai-msg'));
		el.style.marginBottom = '10px';

		switch (role) {
			case 'user':
				el.style.alignSelf = 'flex-end';
				el.style.background = 'var(--vscode-button-background)';
				el.style.color = 'var(--vscode-button-foreground)';
				el.style.padding = '6px 10px';
				el.style.borderRadius = '6px';
				el.style.maxWidth = '80%';
				el.style.marginLeft = 'auto';
				el.textContent = text;
				break;
			case 'assistant':
				el.classList.add('system-msg');
				el.style.padding = '4px 0';
				el.style.color = 'var(--vscode-editor-foreground)';
				el.textContent = text;
				break;
			case 'system':
				el.classList.add('system-msg');
				el.style.fontSize = '11px';
				el.style.color = 'var(--vscode-descriptionForeground)';
				el.style.fontStyle = 'italic';
				el.style.padding = '2px 0';
				el.textContent = text;
				break;
			case 'error':
				el.style.fontSize = '11px';
				el.style.color = 'var(--vscode-errorForeground)';
				el.style.padding = '2px 0';
				el.textContent = text;
				break;
		}

		this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
		return el;
	}

	//#endregion

	override dispose(): void {
		this._cancellation?.cancel();
		super.dispose();
	}
}