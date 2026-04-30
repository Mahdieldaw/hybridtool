# UI

> **Navigation aid.** Component inventory and prop signatures extracted via AST. Read the source files before adding props or modifying component logic.

**84 components** (react)

## Components

- **App** — `ui\App.tsx`
- **AiTurnBlock** — props: aiTurn — `ui\chat\AiTurnBlock.tsx`
- **ChatInput** — props: onStartMapping, canShowMapping, mappingTooltip, mappingActive — `ui\chat\ChatInput.tsx`
- **ChatView** — `ui\chat\ChatView.tsx`
- **CouncilOrbs** — props: turnId, providers, voiceProviderId, onOrbClick, onCrownMove, isTrayExpanded, variant, visibleProviderIds, isEditMode, workflowProgress — `ui\chat\CouncilOrbs.tsx`
- **CouncilOrbsVertical** — `ui\chat\CouncilOrbsVertical.tsx`
- **MessageRow** — props: turnId — `ui\chat\MessageRow.tsx`
- **SingularityOutputView** — props: aiTurn, singularityState, onRecompute, isLoading, copyAllText — `ui\chat\SingularityOutputView.tsx`
- **CognitiveOutputRenderer** — props: aiTurn, singularityState — `ui\chat\TurnOutputRouter.tsx`
- **UserTurnBlock** — props: userTurn — `ui\chat\UserTurnBlock.tsx`
- **WelcomeScreen** — props: onSendPrompt, isLoading — `ui\chat\WelcomeScreen.tsx`
- **BayesianBasinCard** — props: artifact, _selectedEntity — `ui\instrument\cards\BayesianBasinCard.tsx`
- **RoutingCard** — props: artifact, selectedClaim — `ui\instrument\cards\BlastRadiusCard.tsx`
- **BlastVernalInline** — props: artifact — `ui\instrument\cards\BlastRadiusCard.tsx`
- **MixedResolutionInline** — props: artifact — `ui\instrument\cards\BlastRadiusCard.tsx`
- **BlastRadiusCard** — props: artifact, selectedEntity — `ui\instrument\cards\BlastRadiusCard.tsx`
- **Histogram** — props: values, bins, rangeMin, rangeMax, markers, height — `ui\instrument\cards\CardBase.tsx`
- **BinHistogram** — props: bins, binMin, binMax, binWidth, markers, height, zoneBounds — `ui\instrument\cards\CardBase.tsx`
- **StatRow** — props: label, value, color, title — `ui\instrument\cards\CardBase.tsx`
- **CardSection** — props: title, badge — `ui\instrument\cards\CardBase.tsx`
- **InterpretiveCallout** — props: text, variant — `ui\instrument\cards\CardBase.tsx`
- **SortableTable** — props: columns, rows, defaultSortKey, defaultSortDir, emptyMessage, maxRows — `ui\instrument\cards\CardBase.tsx`
- **ClaimDensityCard** — props: artifact — `ui\instrument\cards\ClaimDensityCard.tsx`
- **ClaimStatementsCard** — props: artifact — `ui\instrument\cards\ClaimStatementsCard.tsx`
- **CongruenceCard** — props: artifact — `ui\instrument\cards\CongruenceCard.tsx`
- **GeometryCard** — props: artifact, _selectedEntity — `ui\instrument\cards\GeometryCard.tsx`
- **PassageOwnershipCard** — props: artifact — `ui\instrument\cards\PassageOwnershipCard.tsx`
- **PeripheralNodeCard** — props: artifact — `ui\instrument\cards\PeripheralNodeCard.tsx`
- **RegionsCard** — props: artifact, _selectedEntity — `ui\instrument\cards\RegionsCard.tsx`
- **StatementClassificationCard** — props: artifact — `ui\instrument\cards\StatementClassificationCard.tsx`
- **SubstrateSnapshotCard** — props: artifact, _selectedEntity — `ui\instrument\cards\SubstrateSnapshotCard.tsx`
- **ClaimDetailDrawer** — props: claim, artifact, narrativeText, citationSourceOrder, variant, collapsed, onToggleCollapsed, onClose, onClaimNavigate — `ui\instrument\ClaimDetailDrawer.tsx`
- **ColumnPicker** — props: allColumns, visibleColumnIds, _defaultColumnIds, onToggle, onAddComputed, onReset — `ui\instrument\ColumnPicker.tsx`
- **RiskDonutGlyph** — props: cx, cy, rv, isSel, isHov — `ui\instrument\components\RiskDonutGlyph.tsx`
- **TooltipOverlay** — props: tooltip — `ui\instrument\components\TooltipOverlay.tsx`
- **ContextStrip** — props: artifact, className — `ui\instrument\ContextStrip.tsx`
- **CrossSignalComparePanel** — props: artifact, selectedLayer — `ui\instrument\CrossSignalComparePanel.tsx`
- **DecisionMapSheet** — `ui\instrument\DecisionMapSheet.tsx`
- **EvidenceTable** — props: rows, columns, viewConfig, scope, mode, bottomInset, onSort, onGroup, _onColumnToggle, onRowClick — `ui\instrument\EvidenceTable.tsx`
- **MapperSelector** — props: aiTurn, activeProviderId — `ui\instrument\MapperSelector.tsx`
- **MetricsRibbon** — props: artifact, analysis, problemStructure — `ui\instrument\MetricsRibbon.tsx`
- **NarrativePanel** — props: narrativeText, activeMappingPid, artifact, aiTurnId, rawMappingText — `ui\instrument\NarrativePanel.tsx`
- **ParagraphSpaceView** — props: graph, mutualEdges, regions, basinResult, disabled, citationSourceOrder, paragraphs, claimCentroids, mapperEdges, selectedClaimId — `ui\instrument\ParagraphSpaceView.tsx`
- **RefSection** — props: label, expanded, onToggle, copyText — `ui\instrument\ReferenceSection.tsx`
- **StructuralSummary** — props: analysis, problemStructure, layers — `ui\instrument\StructuralSummary.tsx`
- **StructureGlyph** — props: pattern, residualPattern, claimCount, width, height, onClick — `ui\instrument\StructureGlyph.tsx`
- **SupporterOrbs** — props: supporters, citationSourceOrder, size — `ui\instrument\SupporterOrbs.tsx`
- **ToggleBar** — props: state, actions, hasBasinData — `ui\instrument\ToggleBar.tsx`
- **ClaimRibbon** — props: artifact, focusedClaimId, onFocusClaim — `ui\reading\ClaimRibbon.tsx`
- **ConflictPair** — props: anchor, alternative — `ui\reading\ConflictPair.tsx`
- **ContextCollapse** — props: items — `ui\reading\ContextCollapse.tsx`
- **CorpusSearchPanel** — props: aiTurnId, citationSourceOrder — `ui\reading\CorpusSearchPanel.tsx`
- **EditorialDocument** — props: ast, artifact, citationSourceOrder, onCollapse, onClose — `ui\reading\EditorialDocument.tsx`
- **EditorialPreview** — props: ast, onExpand — `ui\reading\EditorialPreview.tsx`
- **ModelColumn** — props: artifact, modelIndex, modelName, focusedClaimId, highlightMap — `ui\reading\ModelColumn.tsx`
- **ModelGrid** — props: artifact, citationSourceOrder, focusedClaimId, highlightMap — `ui\reading\ModelGrid.tsx`
- **OrientationLine** — props: text — `ui\reading\OrientationLine.tsx`
- **PassageBlock** — props: resolved, role — `ui\reading\PassageBlock.tsx`
- **ThreadIndex** — props: threads, threadOrder, onJumpToThread — `ui\reading\ThreadIndex.tsx`
- **ThreadSection** — props: thread, resolver, threadNumber — `ui\reading\ThreadSection.tsx`
- **CopyButton** — props: text, html, label, buttonText, variant, className, onCopy, disabled — `ui\shared\CopyButton.tsx`
- **MenuIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ChevronDownIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ChevronRightIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ChevronUpIcon** — props: className, style — `ui\shared\Icons.tsx`
- **BotIcon** — props: className, style — `ui\shared\Icons.tsx`
- **UserIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ListIcon** — props: className, style, size — `ui\shared\Icons.tsx`
- **PlusIcon** — props: className, style — `ui\shared\Icons.tsx`
- **TrashIcon** — props: className, style — `ui\shared\Icons.tsx`
- **EllipsisHorizontalIcon** — props: className, style — `ui\shared\Icons.tsx`
- **SettingsIcon** — props: className, style — `ui\shared\Icons.tsx`
- **ListContext** — props: content, components, className — `ui\shared\MarkdownDisplay.tsx`
- **Banner** — `ui\shell\chrome\Banner.tsx`
- **Header** — `ui\shell\chrome\Header.tsx`
- **HistoryPanel** — `ui\shell\chrome\HistoryPanel.tsx`
- **PipelineErrorBanner** — props: type, failedProviderId, onRetry, onExplore, onContinue, compact, errorMessage, requiresReauth, retryable — `ui\shell\chrome\PipelineErrorBanner.tsx`
- **ReconnectOverlay** — props: visible, onReconnect — `ui\shell\chrome\ReconnectOverlay.tsx`
- **RenameDialog** — props: isOpen, onClose, onRename, defaultTitle, isRenaming — `ui\shell\chrome\RenameDialog.tsx`
- **SettingsPanel** — `ui\shell\chrome\SettingsPanel.tsx`
- **ArtifactOverlay** — props: artifact, onClose — `ui\shell\layout\ArtifactOverlay.tsx`
- **ModelResponsePanel** — props: turnId, providerId, sessionId, onClose — `ui\shell\layout\ModelResponsePanel.tsx`
- **ResizableSplitLayout** — props: leftPane, rightPane, isSplitOpen, controlledRatio, onRatioChange, minRatio, maxRatio, dividerContent, className, style — `ui\shell\layout\ResizableSplitLayout.tsx`
- **SplitPaneRightPanel** — `ui\shell\layout\SplitPaneRightPanel.tsx`

---
_Back to [overview.md](./overview.md)_