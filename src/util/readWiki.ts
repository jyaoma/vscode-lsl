import fs from 'fs';
import axios from 'axios';
import { JSDOM } from 'jsdom';

const items = fs.readFileSync(`${__dirname}/functions.txt`, { encoding: 'utf8' }).split('\r\n');
const alreadyDefinedConstants = JSON.parse(fs.readFileSync(`${__dirname}/functions.json`, { encoding: 'utf8' }));

type LSLConstant = {
    declaration: string;
    meaning?: string | null;
    wiki: string;
}

const newItems: { [key: string]: LSLConstant } = alreadyDefinedConstants;
items.forEach(item => {
    if (!Object.keys(alreadyDefinedConstants).includes(item)) {
        axios.get(`https://wiki.secondlife.com/wiki/${item}`)
        .then(({ data }) => {
            const webpage = new JSDOM(data);
            try {
                newItems[item] = {
                    declaration: webpage.window.document.querySelectorAll('#box')[0].children[2].textContent?.slice(11) || '',
                    meaning: webpage.window.document.querySelectorAll('#box')[0].children[3].children[1].textContent,
                    wiki: 'https://wiki.secondlife.com/wiki/' + item
                };
                fs.writeFileSync(`${__dirname}/functions.json`, JSON.stringify(newItems));
            } catch (e) {
                console.error(`A: ${item}`);
            }
        })
        .catch(() => {
            console.error(`B: ${item}`);
        });
    }
});