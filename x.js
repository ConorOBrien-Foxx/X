const XParser = {
    TokenTypes: {
        TEXT: Symbol("XParser.TokenTypes.TEXT"),
        BREAK: Symbol("XParser.TokenTypes.BREAK"),
    },
    
    getDocxFontFromProps(rFont, defaultFont=null) {
        return rFont.getAttribute("w:ascii")
            || rFont.getAttribute("w:hAnsi")
            || rFont.getAttribute("w:cs")
            || defaultFont;
    },
    
    getDocxFont(base) {
        let propTag = base.tagName + "Pr";
        let props = base.getElementsByTagName(propTag)[0];
        let font = props.getElementsByTagName("w:rFonts")[0];
        return this.getDocxFontFromProps(font);
    },
    
    async docx(data) {
        const normalize = (text) =>
            text.replace(/“|”/g, '"')
                .replace(/…/g, "...");
        
        let zip = await this.JSZip.loadAsync(data);
        let xml = await zip.file("word/document.xml").async("string");
        let doc = new this.DOMParser().parseFromString(xml, "text/xml");
        let body = doc.getElementsByTagName("w:body")[0];
        
        let compiled = [];
        
        // i have no idea how to parse a word document, so i'm
        // kind just guessing and winging it
        for(let para of Array.from(body.childNodes)) {
            if(para.tagName !== "w:p") {
                continue;
            }
            let defaultFont = this.getDocxFont(para);
            let content = para.getElementsByTagName("w:r");
            for(let r of Array.from(content)) {
                let rFont = this.getDocxFont(r, defaultFont);
                let texts = r.getElementsByTagName("w:t");
                for(let text of Array.from(texts)) {
                    compiled.push({
                        type: this.TokenTypes.TEXT,
                        font: rFont,
                        text: normalize(text.textContent)
                    });
                }
            }
            compiled.push({
                type: this.TokenTypes.BREAK,
            });
        }
        
        return compiled;
    },
    
    Parsers: {
        DOCX: Symbol("XParser.Parsers.DOCX"),
    },
    getParser(parserType) {
        switch(parserType) {
            case this.Parsers.DOCX:
                return this.docx.bind(this);
            
            default:
                console.error("Unimplemented parser type:", parserType);
                return null;
        }
    },
    
    async parse(data, parserType) {
        parserType ??= this.Parsers.DOCX;
        const parser = await this.getParser(parserType);
        return parser(data);
    },
    
    async transpile(data, browser=false) {
        const fontCache = {};
        const serializeFont = (font) => {
            if(fontCache[font]) {
                return fontCache[font];
            }
            let serialized = font
                .replace(/[^A-Za-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");
            let suffix = "";
            let entries = Object.entries(fontCache);
            while(entries.find(([key, value]) => value == serialized + suffix)) {
                // cursed, but elegant
                suffix++;
            }
            serialized += suffix;
            fontCache[font] = serialized;
            return serialized;
        };
        const BASE_FONT = null;// "Comic Sans MS";
        const onlyX = /^\s*x?\s*$/i;
        let tokens = await XParser.parse(data);
        let baseString = "";
        let fontIndices = [];
        for(let token of tokens) {
            if(token.type === XParser.TokenTypes.BREAK) {
                baseString += "\n";
                continue;
            }
            
            let { font, text } = token;
            // this can only contain an x (upper or lowercase)
            if(BASE_FONT && font !== BASE_FONT && !onlyX.test(text)) {
                console.error("Syntax Error: Unexpected font for non-variable `" + font + "'.");
                console.error(text);
                return null;
            }
            // record the font at this index for later tokenization
            let index = baseString.length;
            if(fontIndices.length === 0 || fontIndices.at(-1).font !== font) {
                fontIndices.push({ index, font });
            }
            baseString += text;
        }
        // transform and transpile
        let headers = new Set();
        let transpiled = "";
        let index = 0;
        
        const HEADERS = {
            "x_Impact": disp`
                // print
                const x_Impact = (...args) => console.log(...args);
            `,
            "x_Arial": disp`
                const x_Arial = Set;
            `,
            "x_Calibri": disp`
                const x_Calibri = (arr, ...args) => arr.push(...args);
            `,
            "x_Times_New_Roman": disp`
                const x_Times_New_Roman = (arr, by="") => arr.join(by);
            `,
        };
        if(browser) {
            HEADERS.x_Impact = disp`
                // print
                const x_Impact = (...args) => {
                    document.getElementById("console-output").value += args.join(" ") + "\\n";
                };
            `;
        }
        
        // from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#keywords
        const RESERVED = `
            abstract await boolean break byte case
            catch char class const continue debugger
            default delete do double else enum
            export extends false final finally float
            for function goto if implements import
            in instanceof int interface let long
            native new null package private protected
            public return short static super switch
            synchronized this throw throws transient true
            try typeof var void volatile while
            with yield
        `.trim().split(/\s+/);
        for(let { type, value } of this.jsTokens(baseString)) {
            if(type === "IdentifierName" && !RESERVED.includes(value)) {
                // first, assert it is x
                if(value !== "x" && value !== "X") {
                    console.error("Syntax Error: Non-X identifier name `" + value + "`");
                }
                
                // get the font at this index
                let font;
                for(let inds of fontIndices) {
                    if(inds.index > index) {
                        break;
                    }
                    font = inds.font;
                }
                
                // "mangle" variable name
                let mangled = `x_${serializeFont(font)}`;
                
                // add corresponding library header, if necessary
                if(HEADERS[mangled]) {
                    headers.add(HEADERS[mangled]);
                }
                
                // add to transpiled
                transpiled += mangled;
            }
            else {
                transpiled += value;
            }
            index += value.length;
        }
        
        // beautify transpiled
        transpiled = this.beautify(transpiled);
        
        let total = [
            ...headers,
            transpiled
        ].join("\n");
        
        return total;
    }
};

const disp = ([ str ]) => {
    let lines = str.split("\n").filter(line => line.trim().length !== 0);
    let indent = " ".repeat(4);
    while(lines.every(line => line.startsWith(indent))) {
        lines = lines.map(line => line.slice(indent.length));
    }
    return lines.join("\n");
};

if(typeof require !== "undefined") {
    // node js execution
    (async function main() {
        const fs = require("fs").promises;
        XParser.JSZip = require("jszip");
        XParser.jsTokens = require("js-tokens");
        XParser.beautify = require("js-beautify");
        const { DOMParser } = require("xmldom");
        XParser.DOMParser = DOMParser;
        // NOTE: xmldom, as of writing, has a moderate vulnerability.
        // but, you shouldn't be running code you don't know anyhow. so.
        // it's probably fine.
        
        let data = await fs.readFile(process.argv[2]);
        let total = await XParser.transpile(data);
        console.log(total);
        eval(total);
    })();
}
else if(typeof document !== "undefined") {
    // browser load
    window.addEventListener("load", function () {
        const compile = document.getElementById("compile");
        const input = document.getElementById("input");
        const output = document.getElementById("output");
        const dropbox = document.getElementById("dropbox");
        const evaluate = document.getElementById("evaluate");
        const consoleOutput = document.getElementById("console-output");
        
        consoleOutput.value = output.value = "";
        
        const handleFile = (file) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                let data = e.target.result;
                let total = await XParser.transpile(data, true);
                output.value = total;
                evaluate.disabled = false;
            };
            reader.readAsBinaryString(file);
        };
        
        dropbox.addEventListener("dragenter", function (e) {
            e.stopPropagation();
            e.preventDefault();
        }, false);
        dropbox.addEventListener("dragover",  function (e) {
            e.stopPropagation();
            e.preventDefault();
        }, false);
        dropbox.addEventListener("drop", function (e) {
            e.stopPropagation();
            e.preventDefault();

            const dt = e.dataTransfer;
            const files = dt.files;
            
            input.files = files;
        }, false);
        dropbox.addEventListener("click", function () {
            input.click();
        });

        compile.addEventListener("click", function () {
            let file = input.files[0];
            handleFile(file);
        });
        
        let silenced = false;
        evaluate.addEventListener("click", function () {
            if(!silenced) {
                if(!confirm("Warning! Do NOT evaluate code you do not trust! ONLY proceed if you are sure the code is safe! This method uses JavaScript `eval` with no protections whatsoever! You have been warned!")) {
                    alert("Evaluation aborted.");
                    return;
                }
                silenced = confirm("Hide these warnings in the future?");
            }
            
            consoleOutput.value = "";
            eval(output.value);
        });
    });
}