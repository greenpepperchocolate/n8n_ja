<script setup lang="ts">
import type { ActionResultRequestDto } from '@n8n/api-types';
import {
	type INodeParameters,
	type INodeProperties,
	isNodeParameters,
	type NodePropertyAction,
} from 'n8n-workflow';
import type { INodeUi, IUpdateInformation } from '@/Interface';
import { ref, computed, onMounted } from 'vue';
import { N8nButton, N8nInput, N8nInputLabel, N8nText, N8nTooltip } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { useToast } from '@n8n/composables/useToast';
import { useEditorContext } from '@/app/composables/useEditorContext';
import { injectNDVStore } from '@/features/ndv/shared/ndv.store';
import {
	getParentNodes,
	generateCodeForAiTransform,
	type TextareaRowData,
	getUpdatedTextareaValue,
	getTextareaCursorPosition,
} from '../../utils/buttonParameter.utils';
import { useTelemetry } from '@n8n/composables/useTelemetry';
import DraggableTarget from '@/app/components/DraggableTarget.vue';

import { propertyNameFromExpression } from '@/app/utils/mappingUtils';
import { injectWorkflowDocumentStore } from '@/app/stores/workflowDocument.store';
import { useWorkflowHelpers } from '@/app/composables/useWorkflowHelpers';
import { useNodeTypesStore } from '@/app/stores/nodeTypes.store';
import { useProjectsStore } from '@/features/collaboration/projects/projects.store';
const AI_TRANSFORM_CODE_GENERATED_FOR_PROMPT = 'codeGeneratedForPrompt';

const emit = defineEmits<{
	valueChanged: [value: IUpdateInformation];
}>();

export type Props = {
	parameter: INodeProperties;
	value: string;
	path: string;
	isReadOnly?: boolean;
};
const props = defineProps<Props>();

const ndvStore = injectNDVStore();
const workflowDocumentStore = injectWorkflowDocumentStore();
const workflowHelpers = useWorkflowHelpers();
const nodeTypesStore = useNodeTypesStore();
const projectsStore = useProjectsStore();

const activeNode = computed(() => ndvStore.value.activeNode);

const i18n = useI18n();

const isLoading = ref(false);
const prompt = ref(props.value);
const parentNodes = ref<INodeUi[]>([]);
const textareaRowsData = ref<TextareaRowData | null>(null);

const hasExecutionData = computed(() => (ndvStore.value.ndvInputData || []).length > 0);
const hasInputField = computed(() => props.parameter.typeOptions?.buttonConfig?.hasInputField);
const inputFieldMaxLength = computed(
	() => props.parameter.typeOptions?.buttonConfig?.inputFieldMaxLength,
);
const buttonLabel = computed(
	() => props.parameter.typeOptions?.buttonConfig?.label ?? props.parameter.displayName,
);
const parameterDisplayName = computed(() =>
	i18n.nodeText(activeNode.value?.type).inputLabelDisplayName(props.parameter, props.path),
);
const parameterDescription = computed(() =>
	i18n.nodeText(activeNode.value?.type).inputLabelDescription(props.parameter, props.path),
);
const { askAi } = useEditorContext();
const isAiTransformButton = computed(() => {
	const action = props.parameter.typeOptions?.buttonConfig?.action;
	return typeof action === 'object' && action?.type === 'askAiCodeGeneration';
});
const isNodeActionButton = computed(() => {
	const action = props.parameter.typeOptions?.buttonConfig?.action;
	return typeof action === 'object' && action?.type === 'invokeNodeAction';
});
const isSubmitEnabled = computed(() => {
	if (isNodeActionButton.value)
		return Boolean(activeNode.value) && !props.isReadOnly && !isLoading.value;
	if (isAiTransformButton.value && !askAi.value) return false;
	if (!hasExecutionData.value || !prompt.value || props.isReadOnly) return false;

	const maxlength = inputFieldMaxLength.value;
	if (maxlength && prompt.value.length > maxlength) return false;

	return true;
});
const promptUpdated = computed(() => {
	const lastPrompt = activeNode.value?.parameters[AI_TRANSFORM_CODE_GENERATED_FOR_PROMPT] as string;
	if (!lastPrompt) return false;
	return lastPrompt.trim() !== prompt.value.trim();
});

function startLoading() {
	isLoading.value = true;
}

function stopLoading() {
	setTimeout(() => {
		isLoading.value = false;
	}, 200);
}

function getPath(parameter: string) {
	return (props.path ? `${props.path}.` : '') + parameter;
}

function toNodeActionResult(value: unknown): INodeParameters | undefined {
	return isNodeParameters(value) ? value : undefined;
}

function isSafeParameterName(value: string): boolean {
	return (
		/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) &&
		!['__proto__', 'constructor', 'prototype'].includes(value)
	);
}

async function invokeNodeAction(action: Extract<NodePropertyAction, { type: 'invokeNodeAction' }>) {
	if (!activeNode.value) return;

	const resolvedNodeParameters = await workflowHelpers.resolveRequiredParameters(
		props.parameter,
		activeNode.value.parameters,
		workflowDocumentStore.value.documentId,
	);
	if (!resolvedNodeParameters) throw new Error(i18n.baseText('nodeParameterAction.failed'));

	const request: ActionResultRequestDto = {
		nodeTypeAndVersion: {
			name: activeNode.value.type,
			version: activeNode.value.typeVersion,
		},
		path: props.path,
		currentNodeParameters: resolvedNodeParameters,
		credentials: activeNode.value.credentials,
		handler: action.handler,
		payload: { parameterPath: props.path },
		projectId: projectsStore.currentProjectId,
		workflowId: workflowDocumentStore.value.workflowId,
	};

	const result = toNodeActionResult(await nodeTypesStore.getNodeParameterActionResult(request));
	if (!result) {
		throw new Error(i18n.baseText('nodeParameterAction.invalidResult'));
	}

	let updatedTarget = false;
	for (const [resultName, target] of Object.entries(action.targets)) {
		if (!isSafeParameterName(target)) {
			throw new Error(i18n.baseText('nodeParameterAction.invalidResult'));
		}
		if (!Object.prototype.hasOwnProperty.call(result, resultName)) continue;
		emit('valueChanged', {
			name: getPath(target),
			value: result[resultName],
		});
		updatedTarget = true;
	}
	if (!updatedTarget) {
		throw new Error(i18n.baseText('nodeParameterAction.invalidResult'));
	}
}

async function onSubmit() {
	const { showMessage } = useToast();
	const action: string | NodePropertyAction | undefined =
		props.parameter.typeOptions?.buttonConfig?.action;

	if (!action || !activeNode.value) return;

	if (typeof action === 'string') {
		switch (action) {
			default:
				return;
		}
	}

	if (action.type === 'askAiCodeGeneration') {
		emit('valueChanged', {
			name: getPath(props.parameter.name),
			value: prompt.value,
		});
	}

	startLoading();

	try {
		switch (action.type) {
			case 'askAiCodeGeneration': {
				const updateInformation = await generateCodeForAiTransform(
					prompt.value,
					getPath(action.target),
					workflowDocumentStore.value.documentId,
					ndvStore.value.activeNode,
					ndvStore.value.pushRef,
					askAi.value,
					5,
				);
				if (!updateInformation) return;

				//update code parameter
				emit('valueChanged', updateInformation);

				//update code generated for prompt parameter
				emit('valueChanged', {
					name: getPath(AI_TRANSFORM_CODE_GENERATED_FOR_PROMPT),
					value: prompt.value,
				});

				useTelemetry().trackAiTransform('generationFinished', ndvStore.value.pushRef, {
					prompt: prompt.value,
					code: updateInformation.value,
				});
				break;
			}
			case 'invokeNodeAction':
				await invokeNodeAction(action);
				break;
			default:
				return;
		}

		showMessage({
			type: 'success',
			title:
				action.type === 'askAiCodeGeneration'
					? i18n.baseText('codeNodeEditor.askAi.generationCompleted')
					: i18n.baseText('nodeParameterAction.completed'),
		});
	} catch (error: unknown) {
		if (action.type === 'askAiCodeGeneration') {
			useTelemetry().trackAiTransform('generationFinished', ndvStore.value.pushRef, {
				prompt: prompt.value,
				code: '',
				hasError: true,
			});
		}
		showMessage({
			type: 'error',
			title:
				action.type === 'askAiCodeGeneration'
					? i18n.baseText('codeNodeEditor.askAi.generationFailed')
					: i18n.baseText('nodeParameterAction.failed'),
			message: error instanceof Error ? error.message : i18n.baseText('generic.unknownError'),
		});
	} finally {
		stopLoading();
	}
}

function onPromptInput(inputValue: string) {
	prompt.value = inputValue;
	emit('valueChanged', {
		name: getPath(props.parameter.name),
		value: inputValue,
	});
}

onMounted(() => {
	parentNodes.value = getParentNodes(
		workflowDocumentStore.value.documentId,
		ndvStore.value.activeNode,
	);
});

function cleanTextareaRowsData() {
	textareaRowsData.value = null;
}

async function onDrop(value: string, event: MouseEvent) {
	value = propertyNameFromExpression(value);

	prompt.value = getUpdatedTextareaValue(event, textareaRowsData.value, value);

	emit('valueChanged', {
		name: getPath(props.parameter.name),
		value: prompt.value,
	});
}

async function updateCursorPositionOnMouseMove(event: MouseEvent, activeDrop: boolean) {
	if (!activeDrop) return;

	const textarea = event.target as HTMLTextAreaElement;

	const position = getTextareaCursorPosition(
		textarea,
		textareaRowsData.value,
		event.clientX,
		event.clientY,
	);

	textarea.focus();
	textarea.setSelectionRange(position, position);
}
</script>

<template>
	<div>
		<div v-if="isNodeActionButton" :class="$style.actionPanel">
			<div :class="$style.actionCopy">
				<N8nText tag="div" size="small" color="text-dark" :bold="true">
					{{ parameterDisplayName }}
				</N8nText>
				<N8nText
					v-if="parameterDescription"
					tag="p"
					size="xsmall"
					color="text-base"
					:class="$style.actionDescription"
				>
					{{ parameterDescription }}
				</N8nText>
			</div>
			<N8nButton
				:class="$style.actionButton"
				icon="crosshair"
				:disabled="!isSubmitEnabled"
				:loading="isLoading"
				size="medium"
				@click="onSubmit"
			>
				{{ buttonLabel }}
			</N8nButton>
			<N8nText
				v-if="isLoading"
				tag="p"
				size="xsmall"
				color="text-base"
				role="status"
				aria-live="polite"
				:class="$style.actionStatus"
			>
				{{ i18n.baseText('nodeParameterAction.waiting') }}
			</N8nText>
		</div>
		<template v-else>
			<N8nInputLabel
				v-if="hasInputField"
				:label="parameterDisplayName"
				:tooltip-text="parameterDescription"
				:bold="false"
				size="small"
				color="text-dark"
			>
			</N8nInputLabel>
			<div
				:class="[$style.inputContainer, { [$style.disabled]: isReadOnly }]"
				:hidden="!hasInputField"
			>
				<div :class="$style.meta">
					<span
						v-if="inputFieldMaxLength"
						v-show="prompt.length > 1"
						:class="$style.counter"
						v-text="`${prompt.length} / ${inputFieldMaxLength}`"
					/>
					<span
						v-if="promptUpdated"
						:class="$style['warning-text']"
						v-text="'Instructions changed'"
					/>
				</div>
				<DraggableTarget type="mapping" :disabled="isLoading" @drop="onDrop">
					<template #default="{ activeDrop, droppable }">
						<N8nInput
							v-model="prompt"
							:class="[
								$style.input,
								{ [$style.activeDrop]: activeDrop, [$style.droppable]: droppable },
							]"
							style="border: 1.5px solid var(--color--foreground)"
							type="textarea"
							:rows="6"
							:maxlength="inputFieldMaxLength"
							:placeholder="parameter.placeholder"
							:disabled="isReadOnly"
							@input="onPromptInput"
							@mousemove="updateCursorPositionOnMouseMove($event, activeDrop)"
							@mouseleave="cleanTextareaRowsData"
						/>
					</template>
				</DraggableTarget>
			</div>
			<div :class="$style.controls">
				<N8nTooltip :disabled="isSubmitEnabled">
					<div>
						<N8nButton
							variant="subtle"
							:disabled="!isSubmitEnabled"
							size="small"
							:loading="isLoading"
							@click="onSubmit"
						>
							{{ buttonLabel }}
						</N8nButton>
					</div>
					<template #content>
						<span
							v-if="!hasExecutionData"
							v-text="i18n.baseText('codeNodeEditor.askAi.noInputData')"
						/>
						<span
							v-else-if="prompt.length === 0"
							v-text="i18n.baseText('codeNodeEditor.askAi.noPrompt')"
						/>
					</template>
				</N8nTooltip>
			</div>
		</template>
	</div>
</template>

<style module lang="scss">
.input * {
	border: 1.5px transparent !important;
}

.input {
	border-radius: var(--radius);
}

.input textarea {
	font-size: var(--font-size--2xs);
	padding-bottom: var(--spacing--2xl);
	font-family: var(--font-family);
	resize: none;
	margin: 0;
}

.intro {
	font-weight: var(--font-weight--bold);
	font-size: var(--font-size--2xs);
	color: var(--color--text--shade-1);
	padding: var(--spacing--2xs) 0 0;
}
.inputContainer {
	position: relative;
}
.meta {
	display: flex;
	justify-content: space-between;
	position: absolute;
	padding-bottom: var(--spacing--2xs);
	padding-top: var(--spacing--2xs);
	bottom: 2px;
	left: var(--spacing--xs);
	right: var(--spacing--xs);
	gap: var(--spacing--2xs);
	align-items: end;
	z-index: 1;
	background-color: var(--color--foreground--tint-2);

	* {
		font-size: var(--font-size--2xs);
		line-height: 1;
	}
}
.counter {
	color: var(--color--text--tint-1);
	flex-shrink: 0;
}
.controls {
	padding: var(--spacing--2xs) 0;
	display: flex;
	justify-content: flex-end;
}
.warning-text {
	color: var(--color--warning);
	line-height: 1.2;
}
.droppable {
	border: 1.5px dashed var(--ndv--droppable-parameter--color) !important;
}
.activeDrop {
	border: 1.5px solid var(--color--success) !important;
	cursor: grabbing;
}
.disabled {
	.meta {
		background-color: var(--input--color--background--disabled);
	}
}

.actionPanel {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--xs);
	padding: var(--spacing--xs);
	border: 1px solid var(--border-color--subtle);
	border-radius: var(--radius--xs);
	background: var(--background--surface);
}

.actionCopy {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--4xs);
}

.actionDescription,
.actionStatus {
	margin: 0;
}

.actionButton {
	width: 100%;
}

.actionStatus {
	padding-top: var(--spacing--4xs);
	border-top: 1px solid var(--border-color--subtle);
}
</style>
