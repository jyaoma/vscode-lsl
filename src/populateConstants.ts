import fs from 'fs';
import axios from 'axios';
import { JSDOM } from 'jsdom';

const constants = fs.readFileSync(`${__dirname}/constants.txt`, { encoding: 'utf8' }).split('\r\n');
const alreadyDefinedConstants = JSON.parse(fs.readFileSync(`${__dirname}/constants.json`, { encoding: 'utf8' }));

type LSLConstant = {
    declaration: string;
    meaning?: string | null;
    wiki: string;
}

const lslConstants: { [key: string]: LSLConstant } = alreadyDefinedConstants;
constants.forEach(constant => {
    if (!Object.keys(alreadyDefinedConstants).includes(constant)) {
        axios.get(`https://wiki.secondlife.com/wiki/${constant}`).then(({ data }) => {
            const webpage = new JSDOM(data);
            const declarationText = webpage.window.document.querySelectorAll('#box')[0].children[1].textContent
            lslConstants[constant] = {
                declaration: declarationText?.slice(11, declarationText.indexOf(';') + 1) || '',
                meaning: webpage.window.document.querySelectorAll('#box')[0].children[2].children[0].textContent,
                wiki: 'https://wiki.secondlife.com/wiki/' + constant
            };
            console.log(lslConstants[constant]);
            fs.writeFileSync(`${__dirname}/constants.json`, JSON.stringify(lslConstants));
        });
    }
});