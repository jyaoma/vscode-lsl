import fs from 'fs';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { LSLFunction, LSLParam } from './lslTypes';

const type = 'functions';

const items = fs.readFileSync(`${__dirname}/../${type}.txt`, { encoding: 'utf8' }).split('\r\n');
const alreadyDefinedConstants = JSON.parse(fs.readFileSync(`${__dirname}/../${type}.json`, { encoding: 'utf8' }));

type SLWiki = {
	[key: string]: string
}

const figureOutParams = (source: string) => {
	const tokens: string[] = [];
	let text = source;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const match = text.match(/\{\{[^{]*?\}\}/);
		if (match) {
			text = text.replace(/\{\{[^{]*?\}\}/, `***token${tokens.length} `);
			tokens.push(match[0]);
		} else {
			break;
		}
	}

	const resolveToken = (i) => {
		let token = tokens[i];
		if (token.includes('***token')) {
			const tokenNumbers = [...token.matchAll(/\*\*\*token(\d+) /g)];
			tokenNumbers.forEach((match) => {
				const numStr = match[1];
				token = token.replace(`***token${numStr} `, resolveToken(parseInt(numStr)));
			});
		}
		
		token = token
			.replace(/\{\{Issues\/.*?\}\}/g, '')
			.replace(/\{\{LSLGC\|.*?\|(.*?)\}\}/g, '$1')
			.replace(/\{\{LSL[A-Z]*\|(.*?)\}\}/g, '$1')
			.replace(/\{\{LSL[_ ]VR\|([^|]*?)\|([^|]*?)\|([^|]*?)\}\}/g, '<$1, $2, $3>')
			.replace(/\{\{NoWrap\|([^|]*)\}\}/g, '$1')
			.replace(/\{\{String\|([^|]*)\}\}/g, '$1')
			.replace(/\{\{mono\|([^|]*)\}\}/g, '$1');
		
		tokens[i] = token;
		return token;
	};

	tokens.forEach((token, i) => {
		resolveToken(i);
	});

	const params = {};
	tokens.forEach(token => {
		if (token.includes('{{LSL_Function/') || token.includes('{{LSL Function/')) {
			const trimmed = token.replace(/\{\{/g, '').replace(/\}\}/g, '');
			const split = trimmed.split('|');
			if (split[0] === 'LSL_Function/avatar') {
				const [ type, param, ...rest ] = split;
				params[param] = `avatar UUID that is in the same region `;
			} else if (split[0] === 'LSL Function/boolean') {
				const [ type, param, ...rest ] = split;
				const meta: { [key: string]: string } = {};
				rest.forEach(r => {
					const [ key, value ] = r.split('=');
					meta[key] = value;
				});
				params[param] = `boolean, if TRUE ${meta.td}, if FALSE ${meta.fd} `;
			} else if (split[0] === 'LSL_Function/chat') {
				const [ type, param, ...rest ] = split;
				params[param] = 'input chat channel, any integer value ';
			} else if (split[0] === 'LSL_Function/detected') {
				const [ type, param, ...rest ] = split;
				params[param] = 'Index of detection information ';
			} else if (split[0] === 'LSL_Function/face') {
				const [ type, param, ...rest ] = split;
				const meta: { [key: string]: string } = {};
				rest.forEach(r => {
					const [ key, value ] = r.split('=');
					meta[key] = value;
				});
				if (meta.notall === '*') {
					params[param] = 'face number ';
				} else {
					params[param] = 'face number or ALL_SIDES ';
				}
			} else if (split[0] === 'LSL_Function/force') {
				const [ type, param, ...rest ] = split;
				const meta: { [key: string]: string } = {};
				rest.forEach(r => {
					const [ key, value ] = r.split('=');
					meta[key] = value;
				});
				params[meta.local] = 'boolean, if TRUE force is treated as a local directional vector, if FALSE force is treated as a region directional vector ';
			} else if (split[0] === 'LSL_Function/give') {
				const [ type, id, name, ...rest ] = split;
				const meta: { [key: string]: string } = {};
				rest.forEach(r => {
					const [ key, value ] = r.split('=');
					meta[key] = value;
				});
				if (meta.prim === '*' && meta.type === 'script' && meta.sim === '*') {
					params[id] = 'prim UUID that is in the same region ';
					params[name] = 'a script in the inventory of the prim this script is in ';
				}
			} else if (split[0] === 'LSL_Function/inventory') {
				const [ type, param, ...rest ] = split;
				const meta: { [key: string]: string } = {};
				rest.forEach(r => {
					const [ key, value ] = r.split('=');
					meta[key] = value;
				});
				params[param] = 'an item in the inventory of the prim this script is in ';
			} else if (split[0] === 'LSL_Function/link') {
				const [ type, param, ...rest ] = split;
				params[param] = 'Link number (0: unlinked, 1: root prim, >1: child prims and seated avatars) or a LINK_* flag ';
			} else if (split[0] === 'LSL_Function/position') {
				const [ type, param, ...rest ] = split;
				params[param] = 'position in region coordinates ';
			} else if (split[0] === 'LSL_Function/prim') {
				const [ type, param, ...rest ] = split;
				params[param] = 'prim UUID that is in the same region ';
			} else if (split[0] === 'LSL_Function/uuid') {
				const [ type, param, ...rest ] = split;
				const meta: { [key: string]: string } = {};
				rest.forEach(r => {
					const [ key, value ] = r.split('=');
					meta[key] = value;
				});
				if (meta.group === '') {
					params[param] = 'avatar or prim UUID that is in the same region ';
				}
				params[param] = 'group, avatar, or prim UUID that is in the same region ';
			}
		}
	});

	console.log(params);
	return params;
};

const writeFunction = (item: string, source: string) => {
	let relevantSource = '';
	source.split('}}{{LSL Function/Head').forEach(source => {
		if (source.includes(`func=${item}`)) {
			relevantSource = source;
		}
	});
	const derivedParams = figureOutParams(relevantSource);
	const sourceList = relevantSource.replace(/&nbsp;/g, ' ')
		.replace(/\n/g, '')
		.replace(/\{\{LSL[_ ]VR\|([^|]*?)\|([^|]*?)\|([^|]*?)\}\}/g, '<$1, $2, $3>')
		.replace(/\{\{LSL[A-Z]*\|([^|]*)\}\}/g, '$1')
		.replace(/\{\{LSL[A-Z]*\|[^|]*?\|([^|]*)\}\}/g, '$1')
		.replace(/\{\{NoWrap\|([^|]*)\}\}/g, '$1')
		.replace(/\{\{String\|([^|]*)\}\}/g, '$1')
		.replace(/\{\{mono\|([^|]*)\}\}/g, '$1')
		.replace(/\{\{\{!\}\}.*\{\{!\}\}\}/g, '')
		.replace(/{{#var:(.*?)}}/g, '$1')
		.replace(/\[\[#NameFormat\|.*?\]\]/g, '')
		.replace(/\[http:\/\/json.org json\]/g, 'json')
		.replace(/\[http:\/\/json.org JSON\]/g, 'JSON')
		.replace(/{{HoverText\|([^|]*?)\|[^|]*?}}/g, '$1')
		.replace(/{{LSL Const\|([^|]*?)\|[^|]*?\|[^|]*?}}/g, '$1')
		.replace(/{{HoverLink\|[^|]*?\|[^|]*?\|([^|]*?)}}/g, '$1')
		.replace(/{{Wikipedia\|([^|]*?)}}/gi, '$1')
		.replace(/{{Wikipedia\|([^|]*?)\|[^|]*?}}/gi, '$1')
		.replace(/\|lteh=.*?\||\|lth=.*?\||\|gteh=.*?\||\|gth=.*?\|/g, '|')
		.replace(/'''(.*?)'''/g, '$1')
		.replace(/''(.*?)''/g, '$1')
		.replace(/'''\[\[[^|]*?\|([^|]*?)\]\]'''/g, '$1')
		.replace(/<code>(.*?)<\/code>/g, '$1')
		.replace(/{{Interval[/a-zA-Z0-9]*(?:\|lte=(.*?))?(?:\|gte=(.*?))?(?:\|lte=(.*?))?(?:\|center=([a-z]+))(?:\|lte=(.*?))?(?:\|gte=(.*?))?(?:\|lte=(.*?))?}}/g, '$2$6 <= $4 <= $1$3$5$7')
		.replace(/{{Interval[/a-zA-Z0-9]*(?:\|lte=(.*?))?(?:\|gt=(.*?))?(?:\|lte=(.*?))?(?:\|center=([a-z]+))(?:\|lte=(.*?))?(?:\|gt=(.*?))?(?:\|lte=(.*?))?}}/g, '$1 <= $2 < $3')
		.replace(/{{Interval[/a-zA-Z0-9]*(?:\|lt=(.*?))?(?:\|gte=(.*?))?(?:\|lt=(.*?))?(?:\|center=([a-z]+))(?:\|lt=(.*?))?(?:\|gte=(.*?))?(?:\|lt=(.*?))?}}/g, '$1 < $2 <= $3')
		.replace(/{{Interval[/a-zA-Z0-9]*(?:\|lt=(.*?))?(?:\|gt=(.*?))?(?:\|lt=(.*?))?(?:\|center=([a-z]+))(?:\|lt=(.*?))?(?:\|gt=(.*?))?(?:\|lt=(.*?))?}}/g, '$1 < $2 < $3')
		.replace(/\[\[([^|]*?)\]\]/g, '$1')
		.replace(/\[\[[^|]*?\|([^|]*?)\]\]/g, '$1')
		.replace(/<!--.*?-->/g, '')
		.replace(/&#32;/g, '')
		.split('|');
	const info: SLWiki = {};
	sourceList?.forEach(lineObj => {
		if (lineObj.includes('=')) {
			const [key, ...value] = lineObj.split('=');
			info[key] = value.join('=');
		}
	});
	// console.log(JSON.stringify(info));
	const params: LSLParam[] = [];
	for (let i = 1; i < 10; i++) {
		if (info[`p${i}_name`]) {
			const name = info[`p${i}_name`];
			params.push({
				type: info[`p${i}_type`],
				name,
				subtype: info[`p${i}_subtype`] || null,
				description: derivedParams[name] ?? '' + (info[`p${i}_desc`] || '')
			});
		}
	}

	try {
		newItems[item] = {
			returnType: info.return_type,
			returns: info.return_text,
			description: info.func_desc,
			parameters: params,
			id: info.func_id ? parseInt(info.func_id) : undefined,
			sleep: parseFloat(info.func_sleep),
			energy: parseFloat(info.func_energy),
			wiki: 'https://wiki.secondlife.com/wiki/' + item,
			deprecated: info.deprecated,
			experimental: source.includes('{{LSL Warnings/Combat2}}'),
			godMode: info.mode === 'god',
			experience: source.includes('cat1=Experience'),
			broken: source.includes('cat4=Broken')
		};
		fs.writeFileSync(`${__dirname}/../${type}.json`, JSON.stringify(newItems));
	} catch (e) {
		console.error(`A: ${item}`);
		console.error(e);
	}
};

const newItems: { [key: string]: LSLFunction } = alreadyDefinedConstants;
items.forEach(item => {
    if (!Object.keys(alreadyDefinedConstants).includes(item)) {
        axios.get(`https://wiki.secondlife.com/w/index.php?title=${item}&action=edit`)
        .then(({ data }) => {
            const webpage = new JSDOM(data);
			const source = webpage.window.document.querySelector('#wpTextbox1')?.textContent;
			if (source.includes('#redirect')) {
				const actualPage = /#redirect\[\[([a-zA-Z0-9]*)#/g.exec(source)?.[1];
				axios.get(`https://wiki.secondlife.com/w/index.php?title=${actualPage}&action=edit`)
				.then(({ data: data2 }) => {
					const webpage2 = new JSDOM(data2);
					const source2 = webpage2.window.document.querySelector('#wpTextbox1')?.textContent;
					writeFunction(item, source2);
				});
			} else {
				writeFunction(item, source);
			}
        })
        .catch((e) => {
            console.error(`B: ${item}`);
			console.error(e);
        });
    }
});