/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
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
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IShiryuAiService } from '../common/shiryuAiService.js';
const $ = DOM.$;

export class ShiryuAiModelManagerView extends ViewPane {

	static readonly ID = 'workbench.view.shiryuAiModelManager';

	private _contentContainer!: HTMLElement;
	private _statusText!: HTMLElement;
	private _modelPathInput!: HTMLInputElement;
	private _loadButton!: HTMLElement;
	private _unloadButton!: HTMLElement;
	private _browseButton!: HTMLElement;
	private _modelInfoContainer!: HTMLElement;
	private readonly _disposables = new DisposableStore();

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
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@ILogService private readonly _logService: ILogService,
	) {
		super(options, keybindingService, contextMenuService, _configurationService,
			contextKeyService, viewDescriptorService, instantiationService,
			openerService, themeService, hoverService);

		this._disposables.add(this._shiryuAiService.onDidChangeAvailability(() => {
			this._refreshStatus();
			this._refreshModelInfo();
		}));

		this._disposables.add(this._shiryuAiService.onDidChangeBusy(() => {
			this._refreshStatus();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._contentContainer = DOM.append(container, $('.shiryu-ai-model-manager-content'));
		this._contentContainer.style.display = 'flex';
		this._contentContainer.style.flexDirection = 'column';
		this._contentContainer.style.padding = '12px';
		this._contentContainer.style.gap = '12px';

		// Status Section
		const statusSection = DOM.append(this._contentContainer, $('.shiryu-ai-status-section'));
		statusSection.style.display = 'flex';
		statusSection.style.flexDirection = 'column';
		statusSection.style.gap = '8px';

		const statusHeader = DOM.append(statusSection, $('h3'));
		statusHeader.textContent = localize('status', 'Model Status');
		statusHeader.style.margin = '0 0 4px 0';
		statusHeader.style.fontSize = '13px';
		statusHeader.style.fontWeight = 'bold';

		this._statusText = DOM.append(statusSection, $('.shiryu-ai-status-text'));
		this._statusText.style.fontSize = '13px';
		this._statusText.style.color = 'var(--vscode-descriptionForeground)';

		// Model Path Section
		const pathSection = DOM.append(this._contentContainer, $('.shiryu-ai-path-section'));
		pathSection.style.display = 'flex';
		pathSection.style.flexDirection = 'column';
		pathSection.style.gap = '6px';

		const pathLabel = DOM.append(pathSection, $('label'));
		pathLabel.textContent = localize('modelPath', 'GGUF Model File');
		pathLabel.style.fontSize = '12px';
		pathLabel.style.fontWeight = 'bold';

		const inputRow = DOM.append(pathSection, $('.shiryu-ai-input-row'));
		inputRow.style.display = 'flex';
		inputRow.style.gap = '6px';

		this._modelPathInput = DOM.append(inputRow, $('input.shiryu-ai-model-path-input')) as HTMLInputElement;
		this._modelPathInput.type = 'text';
		this._modelPathInput.placeholder = localize('modelPathPlaceholder', 'Path to .gguf model file...');
		this._modelPathInput.style.flex = '1';
		this._modelPathInput.style.padding = '4px 8px';
		this._modelPathInput.style.fontSize = '12px';
		this._modelPathInput.style.background = 'var(--vscode-input-background)';
		this._modelPathInput.style.color = 'var(--vscode-input-foreground)';
		this._modelPathInput.style.border = '1px solid var(--vscode-input-border)';
		this._modelPathInput.style.borderRadius = '2px';
		this._modelPathInput.style.outline = 'none';

		const configPath = this._configurationService.getValue<string>('shiryuAi.modelPath');
		if (configPath) {
			this._modelPathInput.value = configPath;
		}

		this._browseButton = DOM.append(inputRow, $('button.shiryu-ai-browse-button'));
		this._browseButton.textContent = localize('browse', 'Browse');
		this._browseButton.style.padding = '4px 12px';
		this._browseButton.style.fontSize = '12px';
		this._browseButton.style.cursor = 'pointer';
		this._browseButton.style.background = 'var(--vscode-button-secondaryBackground)';
		this._browseButton.style.color = 'var(--vscode-button-secondaryForeground)';
		this._browseButton.style.border = '1px solid var(--vscode-button-secondaryBorder)';
		this._browseButton.style.borderRadius = '2px';

		// Action Buttons
		const buttonRow = DOM.append(this._contentContainer, $('.shiryu-ai-button-row'));
		buttonRow.style.display = 'flex';
		buttonRow.style.gap = '8px';

		this._loadButton = DOM.append(buttonRow, $('button.shiryu-ai-load-button'));
		this._loadButton.textContent = localize('loadModel', 'Load Model');
		this._loadButton.style.padding = '6px 16px';
		this._loadButton.style.fontSize = '13px';
		this._loadButton.style.cursor = 'pointer';
		this._loadButton.style.background = 'var(--vscode-button-background)';
		this._loadButton.style.color = 'var(--vscode-button-foreground)';
		this._loadButton.style.border = 'none';
		this._loadButton.style.borderRadius = '2px';
		this._loadButton.style.fontWeight = 'bold';

		this._unloadButton = DOM.append(buttonRow, $('button.shiryu-ai-unload-button'));
		this._unloadButton.textContent = localize('unloadModel', 'Unload Model');
		this._unloadButton.style.padding = '6px 16px';
		this._unloadButton.style.fontSize = '13px';
		this._unloadButton.style.cursor = 'pointer';
		this._unloadButton.style.background = 'var(--vscode-button-secondaryBackground)';
		this._unloadButton.style.color = 'var(--vscode-button-secondaryForeground)';
		this._unloadButton.style.border = '1px solid var(--vscode-button-secondaryBorder)';
		this._unloadButton.style.borderRadius = '2px';

		// Model Info Section
		this._modelInfoContainer = DOM.append(this._contentContainer, $('.shiryu-ai-info-section'));
		this._modelInfoContainer.style.display = 'flex';
		this._modelInfoContainer.style.flexDirection = 'column';

		// Wire up events
		this._disposables.add(DOM.addDisposableListener(this._browseButton, DOM.EventType.CLICK, () => this._browseForModel()));
		this._disposables.add(DOM.addDisposableListener(this._loadButton, DOM.EventType.CLICK, () => this._loadModel()));
		this._disposables.add(DOM.addDisposableListener(this._unloadButton, DOM.EventType.CLICK, () => this._unloadModel()));
		this._disposables.add(DOM.addDisposableListener(this._modelPathInput, DOM.EventType.INPUT, () => {
			if (this._modelPathInput) {
				this._configurationService.updateValue('shiryuAi.modelPath', this._modelPathInput.value);
			}
		}));

		this._refreshStatus();
		this._refreshModelInfo();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	override dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}

	private _refreshStatus(): void {
		if (!this._statusText) {
			return;
		}

		const isAvailable = this._shiryuAiService.isAvailable;
		const isBusy = this._shiryuAiService.isBusy;

		if (isBusy) {
			this._statusText.textContent = localize('generating', 'Generating response...');
			this._statusText.style.color = 'var(--vscode-charts-yellow)';
		} else if (isAvailable) {
			this._statusText.textContent = localize('loaded', 'Model loaded and ready');
			this._statusText.style.color = 'var(--vscode-charts-green)';
		} else {
			this._statusText.textContent = localize('notLoaded', 'No model loaded');
			this._statusText.style.color = 'var(--vscode-descriptionForeground)';
		}

		if (this._loadButton) {
			(this._loadButton as HTMLElement).style.opacity = isAvailable ? '0.5' : '1';
			(this._loadButton as HTMLElement).style.pointerEvents = isAvailable ? 'none' : 'auto';
		}
		if (this._unloadButton) {
			(this._unloadButton as HTMLElement).style.opacity = isAvailable ? '1' : '0.5';
			(this._unloadButton as HTMLElement).style.pointerEvents = isAvailable ? 'auto' : 'none';
		}
	}

	private _refreshModelInfo(): void {
		if (!this._modelInfoContainer) {
			return;
		}

		DOM.clearNode(this._modelInfoContainer);

		const info = this._shiryuAiService.getModelInfo();
		if (!info) {
			this._modelInfoContainer.style.display = 'none';
			return;
		}

		this._modelInfoContainer.style.display = 'flex';
		this._modelInfoContainer.style.flexDirection = 'column';
		this._modelInfoContainer.style.gap = '4px';
		this._modelInfoContainer.style.padding = '8px';
		this._modelInfoContainer.style.background = 'var(--vscode-textBlockQuote-background)';
		this._modelInfoContainer.style.borderRadius = '4px';

		const title = DOM.append(this._modelInfoContainer, $('strong'));
		title.textContent = localize('loadedModel', 'Loaded Model');
		title.style.fontSize = '12px';

		const pathLine = DOM.append(this._modelInfoContainer, $('div'));
		pathLine.textContent = `${localize('path', 'Path')}: ${info.modelPath}`;
		pathLine.style.fontSize = '12px';
		pathLine.style.wordBreak = 'break-all';
		pathLine.style.color = 'var(--vscode-descriptionForeground)';

		const contextLine = DOM.append(this._modelInfoContainer, $('div'));
		contextLine.textContent = `${localize('contextSize', 'Context Size')}: ${info.contextSize.toLocaleString()} tokens`;
		contextLine.style.fontSize = '12px';
		contextLine.style.color = 'var(--vscode-descriptionForeground)';
	}

	private async _browseForModel(): Promise<void> {
		const result = await this._fileDialogService.showOpenDialog({
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: [
				{ name: localize('ggufFiles', 'GGUF Model Files'), extensions: ['gguf'] },
				{ name: localize('allFiles', 'All Files'), extensions: ['*'] },
			],
			title: localize('selectModel', 'Select GGUF Model'),
		});

		if (result && result.length > 0) {
			const modelPath = result[0].fsPath;
			if (this._modelPathInput) {
				this._modelPathInput.value = modelPath;
			}
			this._configurationService.updateValue('shiryuAi.modelPath', modelPath);
		}
	}

	private async _loadModel(): Promise<void> {
		const modelPath = this._modelPathInput?.value.trim();
		if (!modelPath) {
			this._logService.warn('[ShiryuAI] No model path specified');
			return;
		}

		this._logService.info(`[ShiryuAI] Loading model from: ${modelPath}`);

		try {
			await this._shiryuAiService.loadModel({
				modelPath,
				contextSize: this._configurationService.getValue<number>('shiryuAi.contextSize') ?? 4096,
				gpuLayers: this._configurationService.getValue<number>('shiryuAi.gpuLayers') ?? -1,
				temperature: this._configurationService.getValue<number>('shiryuAi.temperature') ?? 0.7,
				maxTokens: this._configurationService.getValue<number>('shiryuAi.maxTokens') ?? 2048,
			});

			this._refreshStatus();
			this._refreshModelInfo();
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			this._logService.error(`[ShiryuAI] Failed to load model: ${errorMsg}`);
		}
	}

	private async _unloadModel(): Promise<void> {
		this._logService.info('[ShiryuAI] Unloading model...');
		await this._shiryuAiService.unloadModel();
		this._refreshStatus();
		this._refreshModelInfo();
	}
}
