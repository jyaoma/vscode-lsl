export type LSLParam = {
	name: string;
	type: string;
	subtype?: string | null;
	description?: string | null;
}

export type LSLEvent = {
    description?: string | null;
	parameters: LSLParam[];
	id?: number;
    wiki: string;
	deprecated?: string;
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

