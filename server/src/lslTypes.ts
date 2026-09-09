import { Position } from 'vscode-languageserver';

export type LSLArgumentDetails = {
	tooltip: string;
	type: LSLType;
}

export type LSLArgument = {
	[name: string]: LSLArgumentDetails;
}

export type LSLFunction = {
	arguments: LSLArgument[];
	energy: number,
	'func-id': number,
	return: LSLType;
	sleep: number;
	tooltip: string;
	categories: string[];
	private?: boolean;
	deprecated?: boolean;
	'god-mode'?: boolean;
	experience?: boolean;
	line?: number;
	column?: number;
	uri?: string;
	isIncluded?: boolean;
	'requires-permission'?: string[];
}

export type LSLDefinitionList<T> = {
	[name: string]: T
}

export type LSLEvent = {
	arguments: LSLArgument[];
	tooltip: string;
	categories: string[];
	deprecated?: boolean;
}

export type LSLConstant = {
	'member-of': string[];
	tooltip: string;
	type: LSLType;
	value: string | number;
}

export enum LSLType {
	Integer = 'integer',
	Float = 'float',
	String = 'string',
	Key = 'key',
	Vector = 'vector',
	Rotation = 'rotation',
	List = 'list',
	Void = 'void',
	Unknown = ''
}

export type LSLTypeDefinition = {
	tooltip: string;
	private?: boolean;
}

export type LSLControlDefinition = {
	tooltip: string;
	deprecated?: boolean;
}

export type LSLDefinitionYaml = {
	constants: LSLDefinitionList<LSLConstant>;
	events: LSLDefinitionList<LSLEvent>;
	functions: LSLDefinitionList<LSLFunction>;
	types: LSLDefinitionList<LSLTypeDefinition>;
	controls: LSLDefinitionList<LSLControlDefinition>;
}

export type LSLReference = Position & {
	isWrite: boolean
}

export type LSLVariable = {
  name: string;
  type: LSLType;
  line: number;
  column: number;
  columnWithType: number;
  references: LSLReference[];
  isParameter?: boolean;
  isPreprocessor?: boolean;
  isIncluded?: boolean;
  isGlobal?: boolean;
  uri?: string;
  value?: string;
  macroParams?: string;
  comment?: string;
};

export type LSLFunctionCall = Position & {
	functionName: string;
}

export type LSLJumpLabel = {
	name: string;
	line: number;
	character: number;
	uri?: string;
	isDefinition: boolean;
}