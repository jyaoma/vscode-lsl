"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const axios_1 = __importDefault(require("axios"));
const jsdom_1 = require("jsdom");
const items = fs_1.default.readFileSync(`${__dirname}/functions.txt`, { encoding: 'utf8' }).split('\r\n');
const alreadyDefinedConstants = JSON.parse(fs_1.default.readFileSync(`${__dirname}/functions.json`, { encoding: 'utf8' }));
const newItems = alreadyDefinedConstants;
items.forEach(item => {
    if (!Object.keys(alreadyDefinedConstants).includes(item)) {
        axios_1.default.get(`https://wiki.secondlife.com/wiki/${item}`)
            .then(({ data }) => {
            const webpage = new jsdom_1.JSDOM(data);
            try {
                newItems[item] = {
                    declaration: webpage.window.document.querySelectorAll('#box')[0].children[2].textContent?.slice(11) || '',
                    meaning: webpage.window.document.querySelectorAll('#box')[0].children[3].children[1].textContent,
                    wiki: 'https://wiki.secondlife.com/wiki/' + item
                };
                fs_1.default.writeFileSync(`${__dirname}/functions.json`, JSON.stringify(newItems));
            }
            catch (e) {
                console.error(`A: ${item}`);
            }
        })
            .catch(() => {
            console.error(`B: ${item}`);
        });
    }
});
//# sourceMappingURL=readWiki.js.map