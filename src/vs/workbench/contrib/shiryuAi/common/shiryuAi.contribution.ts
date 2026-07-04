/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Shiryu Studios LLC. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IShiryuAiService } from './shiryuAiService.js';
import { ShiryuAiService } from './shiryuAiServiceImpl.js';
import { IShiryuToolService } from './shiryuAiTools.js';
import { ShiryuToolService } from './shiryuAiToolServiceImpl.js';

// Register ShiryuAiService as a singleton
registerSingleton(IShiryuAiService, ShiryuAiService, InstantiationType.Delayed);

// Register ShiryuToolService as a singleton
registerSingleton(IShiryuToolService, ShiryuToolService, InstantiationType.Delayed);
