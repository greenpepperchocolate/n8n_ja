/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import ButtonParameter, { type Props } from './ButtonParameter.vue';
import { useNDVStore, injectNDVStore } from '@/features/ndv/shared/ndv.store';
import { useWorkflowsStore } from '@/app/stores/workflows.store';
import { usePostHog } from '@/app/stores/posthog.store';
import { useRootStore } from '@n8n/stores/useRootStore';
import { useToast } from '@n8n/composables/useToast';
import type { INodeProperties } from 'n8n-workflow';

const nodeActionMocks = vi.hoisted(() => ({
	resolveRequiredParameters: vi.fn(),
	getNodeParameterActionResult: vi.fn(),
}));

vi.mock('@/features/ndv/shared/ndv.store');
vi.mock('@/app/stores/workflows.store');
vi.mock('@/app/stores/posthog.store');
vi.mock('@n8n/stores/useRootStore');
vi.mock('@/features/ai/assistant/assistant.api');
vi.mock('@/app/composables/useWorkflowHelpers', () => ({
	useWorkflowHelpers: () => ({
		resolveRequiredParameters: nodeActionMocks.resolveRequiredParameters,
	}),
}));
vi.mock('@/app/stores/nodeTypes.store', () => ({
	useNodeTypesStore: () => ({
		getNodeParameterActionResult: nodeActionMocks.getNodeParameterActionResult,
	}),
}));
vi.mock('@/features/collaboration/projects/projects.store', () => ({
	useProjectsStore: () => ({ currentProjectId: 'test-project-id' }),
}));
vi.mock('@/app/stores/workflowDocument.store', async () => {
	const actual = await vi.importActual('@/app/stores/workflowDocument.store');
	const { shallowRef } = await import('vue');
	const mockStore = {
		documentId: 'test-document-id',
		workflowId: 'test-workflow-id',
		getParentNodesByDepth: vi.fn().mockReturnValue([]),
		getNodeByName: vi.fn().mockReturnValue(null),
	};
	return {
		...actual,
		useWorkflowDocumentStore: vi.fn(() => mockStore),
		createWorkflowDocumentId: vi.fn().mockReturnValue('test-id'),
		injectWorkflowDocumentStore: vi.fn(() => shallowRef(mockStore)),
	};
});
vi.mock('@n8n/i18n', async (importOriginal) => ({
	...(await importOriginal()),
	useI18n: () => ({
		baseText: vi.fn().mockReturnValue('Mocked Text'),
		nodeText: () => ({
			inputLabelDisplayName: vi.fn().mockReturnValue('Mocked Display Name'),
			inputLabelDescription: vi.fn().mockReturnValue('Mocked Description'),
		}),
	}),
}));
vi.mock('@n8n/composables/useToast');
vi.mock('@/app/composables/useEditorContext', () => ({
	useEditorContext: () => ({
		aiAssistant: { value: true },
		aiBuilder: { value: true },
		askAi: { value: true },
		readOnly: { value: false },
	}),
}));
vi.mock('../../utils/buttonParameter.utils', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../utils/buttonParameter.utils')>()),
	generateCodeForAiTransform: vi.fn().mockResolvedValue({
		name: 'testPath.targetParam',
		value: 'generated code',
	}),
}));

describe('ButtonParameter', () => {
	const defaultProps: Props = {
		parameter: {
			name: 'testParam',
			displayName: 'Test Parameter',
			type: 'string',
			default: '',
			typeOptions: {
				buttonConfig: {
					label: 'Generate',
					action: {
						type: 'askAiCodeGeneration',
						target: 'targetParam',
					},
					hasInputField: true,
				},
			},
		} as INodeProperties,
		value: '',
		isReadOnly: false,
		path: 'testPath',
	};

	beforeEach(() => {
		nodeActionMocks.resolveRequiredParameters.mockImplementation((_parameter, parameters) =>
			Promise.resolve(parameters),
		);
		nodeActionMocks.getNodeParameterActionResult.mockResolvedValue({});

		vi.mocked(useNDVStore).mockReturnValue({
			ndvInputData: [{}],
			activeNode: {
				name: 'TestNode',
				type: 'test.node',
				typeVersion: 1,
				parameters: {},
			},
			isDraggableDragging: false,
		} as any);

		vi.mocked(injectNDVStore).mockReturnValue({
			value: {
				ndvInputData: [{}],
				ndvInputDataWithPinnedData: [{}],
				activeNode: {
					name: 'TestNode',
					type: 'test.node',
					typeVersion: 1,
					parameters: {},
				},
				isDraggableDragging: false,
				pushRef: 'testPushRef',
			},
		} as any);

		vi.mocked(useWorkflowsStore).mockReturnValue({
			workflowId: 'test-workflow-id',
			getNodeByName: vi.fn().mockReturnValue({}),
		} as any);

		vi.mocked(usePostHog).mockReturnValue({
			isAiEnabled: vi.fn().mockReturnValue(true),
			getVariant: vi.fn().mockReturnValue('gpt-3.5-turbo-16k'),
		} as any);

		vi.mocked(useRootStore).mockReturnValue({
			versionCli: '1.0.0',
			pushRef: 'testPushRef',
		} as any);

		vi.mocked(useToast).mockReturnValue({
			showMessage: vi.fn(),
		} as any);
	});

	const mountComponent = (props: Partial<Props> = {}) => {
		return mount(ButtonParameter, {
			props: { ...defaultProps, ...props },
			global: {
				plugins: [createTestingPinia()],
			},
		});
	};

	it('renders correctly', () => {
		const wrapper = mountComponent();
		expect(wrapper.find('textarea').exists()).toBe(true);
		expect(wrapper.find('button').text()).toBe('Generate');
	});

	it('emits valueChanged event on input', async () => {
		const wrapper = mountComponent();
		const input = wrapper.find('textarea');
		await input.setValue('Test prompt');
		expect(wrapper.emitted('valueChanged')).toBeTruthy();
		expect(wrapper.emitted('valueChanged')![0][0]).toEqual({
			name: 'testPath.testParam',
			value: 'Test prompt',
		});
	});

	it('disables submit button when there is no execution data', async () => {
		vi.mocked(useNDVStore).mockReturnValue({
			ndvInputData: [],
		} as any);
		const wrapper = mountComponent();
		expect(wrapper.find('button').attributes('disabled')).toBeDefined();
	});

	it('disables submit button when prompt is empty', async () => {
		const wrapper = mountComponent();
		expect(wrapper.find('button').attributes('disabled')).toBeDefined();
	});

	it('enables submit button when there is execution data and prompt', async () => {
		const wrapper = mountComponent();
		await wrapper.find('textarea').setValue('Test prompt');
		expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
	});

	it('calls onSubmit when button is clicked', async () => {
		const wrapper = mountComponent();
		await wrapper.find('textarea').setValue('Test prompt');

		const submitButton = wrapper.find('button');
		expect(submitButton.attributes('disabled')).toBeUndefined();

		await submitButton.trigger('click');

		expect(useToast().showMessage).toHaveBeenCalled();
	});

	it('disables input and button when in read only mode', async () => {
		const wrapper = mountComponent({ isReadOnly: true });
		expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();
		expect(wrapper.find('button').attributes('disabled')).toBeDefined();
	});

	it('does not update parameters when a node action returns an empty result', async () => {
		const wrapper = mountComponent({
			parameter: {
				name: 'elementPicker',
				displayName: 'Pick element',
				type: 'button',
				default: '',
				typeOptions: {
					buttonConfig: {
						label: 'Pick',
						action: {
							type: 'invokeNodeAction',
							handler: 'pickElement',
							targets: { locatorType: 'locatorType' },
						},
					},
				},
			} as INodeProperties,
			path: 'steps.step[0]',
		});

		await wrapper.find('button').trigger('click');
		await flushPromises();

		expect(nodeActionMocks.getNodeParameterActionResult).toHaveBeenCalledOnce();
		expect(wrapper.emitted('valueChanged')).toBeUndefined();
		expect(useToast().showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
	});

	it('runs a node action without input data and applies its parameter targets', async () => {
		vi.mocked(injectNDVStore).mockReturnValue({
			value: {
				ndvInputData: [],
				ndvInputDataWithPinnedData: [],
				activeNode: {
					name: 'TestNode',
					type: 'test.node',
					typeVersion: 1,
					parameters: {},
				},
				isDraggableDragging: false,
				pushRef: 'testPushRef',
			},
		} as any);
		nodeActionMocks.getNodeParameterActionResult.mockResolvedValue({
			locatorType: 'role',
			locatorRole: 'heading',
			locatorName: 'Customer name',
		});

		const wrapper = mountComponent({
			parameter: {
				name: 'elementPicker',
				displayName: 'Pick element',
				type: 'button',
				default: '',
				typeOptions: {
					buttonConfig: {
						label: 'Pick',
						action: {
							type: 'invokeNodeAction',
							handler: 'pickElement',
							targets: {
								locatorType: 'locatorType',
								locatorRole: 'locatorRole',
								locatorName: 'locatorName',
							},
						},
					},
				},
			} as INodeProperties,
			path: 'steps.step[4]',
		});

		const button = wrapper.find('button');
		expect(button.attributes('disabled')).toBeUndefined();

		await button.trigger('click');
		await flushPromises();

		expect(wrapper.emitted('valueChanged')).toEqual([
			[{ name: 'steps.step[4].locatorType', value: 'role' }],
			[{ name: 'steps.step[4].locatorRole', value: 'heading' }],
			[{ name: 'steps.step[4].locatorName', value: 'Customer name' }],
		]);
	});
});
