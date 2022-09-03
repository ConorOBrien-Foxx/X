@ECHO OFF
ECHO Checking requirements are installed...

REM The below CMD /C are required to prevent
REM the script from exiting prematurely

CMD /C "npm list -g" >tmp

FINDSTR "minify@" <tmp >nul || (
    ECHO Installing minify... && npm install -g minify
)
FINDSTR "browserify@" <tmp >nul || (
    ECHO Installing browserify... && npm install -g browserify
)

DEL tmp

ECHO Browserifying...
CMD /C "browserify pseudo-index.js -o rtf-parser.js"

ECHO Minifying...
CMD /C "minify --js <rtf-parser.js >rtf-parser.min.js"

ECHO Cleaning up...
DEL rtf-parser.js
