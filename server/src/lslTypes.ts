import { Position } from 'vscode-languageserver';

export type LSLParam = {
	name: string;
	type: string;
	subtype?: string | null;
	description?: string | null;
}

export type LSLFunction = {
    returnType?: string;
	returns?: string;
    description?: string | null;
	parameters: LSLParam[];
	id?: number;
	sleep: number;
	energy: number;
    wiki: string;
	deprecated?: string;
	experimental: boolean;
	godMode: boolean;
	experience: boolean;
	broken: boolean;
}

export type LSLEvent = {
    description?: string | null;
	parameters: LSLParam[];
	id?: number;
    wiki: string;
	deprecated?: string;
}

export type LSLConstant = {
	name: string;
	type: string;
	value: string;
	meaning?: string | null;
	wiki: string;
}

export enum LSLType {
	Integer = 'integer',
	Float = 'float',
	String = 'string',
	Key = 'key',
	Vector = 'vector',
	Rotation = 'rotation',
	List = 'list',
	Unknown = ''
}

export type LSLVariable = {
  name: string;
  type: LSLType;
  line: number;
  column: number;
  columnWithType: number;
  references: Position[];
};