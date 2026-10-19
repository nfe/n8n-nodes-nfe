import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

/** One operation run for one input item. The router adds `pairedItem`. */
export type OperationHandler = (
	ctx: IExecuteFunctions,
	itemIndex: number,
) => Promise<INodeExecutionData[]>;
