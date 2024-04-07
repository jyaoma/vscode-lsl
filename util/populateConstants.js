"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const axios_1 = __importDefault(require("axios"));
const jsdom_1 = require("jsdom");
const constants = fs_1.default.readFileSync(`${__dirname}/constants.txt`, { encoding: 'utf8' }).split('\r\n');
const alreadyDefinedConstants = JSON.parse(fs_1.default.readFileSync(`${__dirname}/constants.json`, { encoding: 'utf8' }));
const lslConstants = alreadyDefinedConstants;
constants.forEach(constant => {
    if (!Object.keys(alreadyDefinedConstants).includes(constant)) {
        axios_1.default.get(`https://wiki.secondlife.com/wiki/${constant}`).then(({ data }) => {
            const webpage = new jsdom_1.JSDOM(data);
            const declarationText = webpage.window.document.querySelectorAll('#box')[0].children[1].textContent;
            lslConstants[constant] = {
                declaration: declarationText?.slice(11, declarationText.indexOf(';') + 1) || '',
                meaning: webpage.window.document.querySelectorAll('#box')[0].children[2].children[0].textContent,
                wiki: 'https://wiki.secondlife.com/wiki/' + constant
            };
            console.log(lslConstants[constant]);
            fs_1.default.writeFileSync(`${__dirname}/constants.json`, JSON.stringify(lslConstants));
        });
    }
});
//# sourceMappingURL=populateConstants.js.map