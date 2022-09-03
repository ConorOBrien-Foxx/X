// utility for quoting code nicely
const disp = ([ str ]) => {
    let lines = str.split("\n").filter(line => line.trim().length !== 0);
    let indent = " ".repeat(4);
    while(lines.every(line => line.startsWith(indent))) {
        lines = lines.map(line => line.slice(indent.length));
    }
    return lines.join("\n");
};

const XParser = {
    error(...args) {
        console.error(args);
    },
    
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
                        text: text.textContent
                    });
                }
            }
            compiled.push({
                type: this.TokenTypes.BREAK,
            });
        }
        
        return compiled;
    },
    
    getRTFDoc(input) {
        let method;
        if(typeof input.pipe !== "undefined") {
            method = "stream";
        }
        else {
            method = "string";
        }
        return new Promise((resolve, reject) => {
            this.parseRTF[method](input, (err, doc) => {
                if(err) {
                    return reject(err);
                }
                resolve(doc);
            });
        });
    },
    
    async rtf(data) {
        let compiled = [];
        let doc = await this.getRTFDoc(data);
        let paras = doc.content;
        
        let baseFont = doc.style.font?.name;
        for(let para of paras) {
            let innerBaseFont = para.style.font?.name ?? baseFont;
            for(let span of para.content) {
                compiled.push({
                    type: this.TokenTypes.TEXT,
                    font: span.style.font?.name ?? innerBaseFont,
                    text: span.value
                });
            }
            compiled.push({
                type: this.TokenTypes.BREAK
            });
        }
        
        return compiled;
    },
    
    Parsers: {
        DOCX: Symbol("XParser.Parsers.DOCX"),
        RTF: Symbol("XParser.Parsers.RTF"),
    },
    getParser(parserType) {
        switch(parserType) {
            case this.Parsers.DOCX:
                return this.docx.bind(this);
            
            case this.Parsers.RTF:
                return this.rtf.bind(this);
            
            default:
                this.error("Unimplemented parser type:", parserType);
                return null;
        }
    },
    
    ExtensionToParser: undefined,
    extensionMatch: /\.([^.]+)$/,
    getParserFromExtension(fileName) {
        this.ExtensionToParser ??= {
            "docx": this.Parsers.DOCX,
            "rtf": this.Parsers.RTF,
        };
        
        let extension = fileName.match(this.extensionMatch)?.at(-1)?.toLowerCase();
        let parser = this.ExtensionToParser[extension]
        
        if(!parser) {
            XParser.error("Error: Unrecognized extension", extension);
            return;
        }
        
        return parser;
    },
    
    normalize: (text) =>
        text.replace(/“|”/g, '"')
            .replace(/…/g, "..."),
    
    async parse(data, parserType) {
        parserType ??= this.Parsers.DOCX;
        const parser = await this.getParser(parserType);
        let tokens = await parser(data);
        return tokens.map(token =>
            token.text
                ? { ...token, text: this.normalize(token.text) }
                : token
        );
    },
    
    serializeFont(name, cache) {
        if(cache[name]) {
            return cache[name];
        }
        let serialized = name
            .replace(/[^A-Za-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        let suffix = "";
        let entries = Object.entries(cache);
        while(entries.find(([key, value]) => value == serialized + suffix)) {
            // cursed, but elegant
            suffix++;
        }
        serialized += suffix;
        cache[name] = serialized;
        return serialized;
    },
    
    onlyX: /^\s*x?\s*$/i,
    
    VariableHeaders: {
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
    },
    
    async transpile(data, options={}) {
        options.parserType ??= undefined;
        options.baseFont ??= null;
        // try, "Comic Sans MS"
        
        const BASE_FONT = options.baseFont;
        const fontCache = {};
        
        let tokens = await XParser.parse(data, options.parserType);
        let baseString = "";
        let fontIndices = [];
        for(let token of tokens) {
            if(token.type === XParser.TokenTypes.BREAK) {
                baseString += "\n";
                continue;
            }
            
            let { font, text } = token;
            if(BASE_FONT) {
                // this text can only contain an x (upper or lowercase)
                if(font !== BASE_FONT && !this.onlyX.test(text)) {
                    this.error("Syntax Error: Unexpected font for non-variable `" + font + "'.");
                    this.error(text);
                    return null;
                }
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
                if(value !== "x" && value !== "X") {
                    this.error("Syntax Error: Non-X identifier name `" + value + "`");
                }
                
                // get the font at this index
                let font;
                for(let inds of fontIndices) {
                    if(inds.index > index) {
                        break;
                    }
                    font = inds.font;
                }
                
                let mangled = `x_${this.serializeFont(font, fontCache)}`;
                
                if(this.VariableHeaders[mangled]) {
                    headers.add(this.VariableHeaders[mangled]);
                }
                else if(mangled === "x_Papyrus") {
                    mangled = "this";
                }
                
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

if(typeof require !== "undefined") {
    // node js execution
    (async function main() {
        const fs = require("fs").promises;
        XParser.JSZip = require("jszip");
        XParser.jsTokens = require("js-tokens");
        XParser.beautify = require("js-beautify");
        const { DOMParser } = require("xmldom");
        XParser.DOMParser = DOMParser;
        XParser.parseRTF = require("rtf-parser");
        // NOTE: xmldom, as of writing, has a moderate vulnerability.
        // but, you shouldn't be running code you don't know anyhow. so.
        // it's probably fine.
        
        let fileName = process.argv[2]
        let data = await fs.readFile(fileName);
        let parser = XParser.getParserFromExtension(fileName);
        if(!parser) {
            return;
        }
        let total = await XParser.transpile(data, {
            parserType: parser
        });
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
        const inputProxy = document.getElementById("input-proxy");
        
        const updateProxy = () => {
            inputProxy.textContent = "File: " + (
                input.files.length === 0
                    ? "No files selected."
                    : input.files[0].name
            );
        };
        
        updateProxy();
        
        input.addEventListener("change", updateProxy);
        
        XParser.error = (...args) => {
            consoleOutput.value += args.join(" ") + "\n";
        };
        XParser.VariableHeaders.x_Impact = disp`
            // print
            const x_Impact = (...args) => {
                document.getElementById("console-output").value += args.join(" ") + "\\n";
            };
        `;
        
        consoleOutput.value = output.value = "";
        
        const handleFile = (file) => {
            let parser = XParser.getParserFromExtension(file.name);
            if(!parser) {
                return;
            }
            const reader = new FileReader();
            reader.onload = async (e) => {
                let data = e.target.result;
                let total = await XParser.transpile(data, {
                    parserType: parser,
                });
                output.value = total;
                evaluate.disabled = false;
            };
            reader.readAsBinaryString(file);
        };
        
        const dragEvent = function (e) {
            e.stopPropagation();
            e.preventDefault();
        };
        
        dropbox.addEventListener("dragenter", dragEvent, false);
        dropbox.addEventListener("dragover", dragEvent, false);
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
            if(!file) {
                XParser.error("Error: no file provided");
                return;
            }
            handleFile(file);
        });
        
        let silenced = false;
        evaluate.addEventListener("click", function () {
            if(!output.value) {
                XParser.error("Error: no file provided");
                return;
            }
            
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
        evaluate.disabled = true;
    });
}