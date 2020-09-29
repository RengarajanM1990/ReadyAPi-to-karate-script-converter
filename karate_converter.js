const xml2js = require('xml2js');
const async = require('async');
const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const serviceStack = [];
const servicesMap = {};
const sCount = 0;
const TestSuiteMap = {};
// eslint-disable-next-line no-unused-vars
const testSuiteDescMap = {
    rest: 0,
    jdbc: 0,
    groovy: 0,
    totalTestStep: 0,
};

// servicesMap is a map from
// "service|path|method" to the node

// TODOs:
// 1. a con:resource might have a nested con:resource
// we'll need to flatten these out before parsing
// get a map from (Service||Path||Method) to the resource object -> lower priority

// 2. resolution of variables

// 3. tests

function getRequestTemplate(service, path, method, restRequest, cb) {
    // read all xml files at pathToProject+service
    // try to find in smap
    let params = {
        service,
        path,
        method,
    };
    if (servicesMap[service + '||' + path]) {
        const resourceNode = servicesMap[service + '||' + path];
        let foundMethodInNode = false;
        // find the method in this
        _.each(resourceNode.method, m => {
            if (m.$.name === method) {
                _.set(resourceNode, 'resource.method', m);
                foundMethodInNode = true;
                return false;
            }
        });
        if (foundMethodInNode) {
            // console.log('Used cache');
            return cb(null, params, resourceNode, restRequest);
        }
    }
    // there is an issue where the folder name is being converted to standard url syntax of https://
    // which is causing the folder to not be found
    service = unifyService(service);
    const filePath = getParentFolderPath(process.env.pathToProject, service);
    fs.readdir(filePath, (err, allFileList) => {
        if (err) {
            console.error('unable to find Path please check :\n', err);
            process.exit(0);
            return cb(err);
        }
        let list = [];
        _.each(allFileList, f => {
            if (f.endsWith('.xml')) {
                list.push(f);
            }
        });

        // read all files till you find what you want
        // we'll need to build a map from "service-path-method" to the file
        var currentListIndex = 0;
        var endOfList = false;
        var currentXmlDom;
        var foundNode = null;
        var foundMethodInNode;
        async.until(
            function() {
                if (_.get(currentXmlDom, 'resource.$.path') === path) {
                    // found it
                    if (
                        (foundMethodInNode = _.find(
                            _.get(currentXmlDom, 'resource.method'),
                            methodNode => {
                                return (
                                    _.get(methodNode, '$.name', '') === method
                                );
                            }
                        ))
                    ) {
                        foundNode = currentXmlDom;
                        foundNode.resource.method = foundMethodInNode;
                    }
                    return true;
                } else if (endOfList) {
                    // didn't find it
                    return true;
                }
                return false; // call the iteratee again
            },
            function(callback) {
                // iteratee:
                // finding the right request/method
                getXmlNodeFromFilePath(
                    process.env.pathToProject +
                        service +
                        '/' +
                        list[currentListIndex],
                    (err, data) => {
                        currentListIndex++;
                        if (currentListIndex >= list.length) {
                            endOfList = true;
                        } else {
                            currentXmlDom = data;
                        }
                        callback();
                    }
                );
            },
            function() {
                cb(null, params, foundNode, restRequest);
            }
        );
    });
}

function unifyService(service) {
    if (service.startsWith('https://')) {
        service = service
            .replace('https://', 'https%3A%2F%2F')
            .replace(/:/g, '%3A')
            .replace(/\//g, '%2F')
            .replace(/\s+/g, '-');
    } else if (service.startsWith('http://')) {
        service = service
            .replace('http://', 'http%3A%2F%2F')
            .replace(/:/g, '%3A')
            .replace(/\//g, '%2F')
            .replace(/\s+/g, '-');
    }
    return service;
}

//
function getParentFolderPath(parentFilePath, service) {
    let filePath = parentFilePath + service;
    if (!fs.existsSync(filePath)) {
        if (
            fs.existsSync(
                process.env.pathToProject + encodeURIComponent(service)
            )
        ) {
            filePath = process.env.pathToProject + encodeURIComponent(service);
        } else if (
            fs.existsSync(
                process.env.pathToProject + service.replace(/\s+/g, '-')
            )
        ) {
            filePath = process.env.pathToProject + service.replace(/\s+/g, '-');
        } else if (
            fs.existsSync(
                process.env.pathToProject + service.replace(/\s+/g, '_')
            )
        ) {
            filePath = process.env.pathToProject + service.replace(/\s+/g, '_');
        } else if (
            fs.existsSync(
                process.env.pathToProject + service.replace(/\s+/g, '')
            )
        ) {
            filePath = process.env.pathToProject + service.replace(/\s+/g, '');
        }
    }
    return filePath;
}

// synchronous
function getHeadersForRequest(headers) {
    var hMap = {};
    var key;
    _.each(headers, h => {
        key = _.get(h, 'name.0');
        if (key) {
            hMap[key] = _.get(h, 'default.0', '');
        }
    });
    return _.map(hMap, (v, k) => {
        return {
            key: k,
            value: setVariablesInString(v),
        };
    });
}

function getQueryParams(qps, restValueshashmap) {
    let qname;
    let queryParams;
    const query =
        _.uniq(
            _.map(qps, qp => {
                if ((qname = _.get(qp, 'name.0', null))) {
                    const value = restValueshashmap[qname]
                        ? setVariablesInParmas(restValueshashmap[qname])
                        : setVariablesInParmas(
                              _.get(qp, 'value.0', _.get(qp, 'default.0', ''))
                          );
                    queryParams = 'And param ' + qname + ' = ' + value;
                    console.log(queryParams);
                    return queryParams;
                }
            })
        ).join('\n') + '\n';
    return query === '\n'
        ? query
        : query.replace(/#\(/g, '').replace(/\)/g, '');
}

function setHeaders(hdr, restValueshashmap) {
    let headerName;
    const default_header = getHeadersForRequest(hdr);
    const header =
        _.uniq(
            _.map(hdr, hd => {
                if ((headerName = _.get(hd, 'name.0', null))) {
                    let header_value = restValueshashmap[headerName]
                        ? setVariablesInParmas(restValueshashmap[headerName])
                        : setVariablesInParmas(
                              _.get(hd, 'value.0', _.get(hd, 'default.0', ''))
                          );
                    if (header_value.includes("''")) {
                        _.each(default_header, h => {
                            if (h.key === headerName) {
                                header_value = setVariablesInParmas(h.value);
                            }
                        });
                    }
                    return 'Given header ' + headerName + ' = ' + header_value;
                }
            })
        ).join('\n') + '\n';
    return header.replace(/#\(/g, '').replace(/\)/g, '');
}

// eslint-disable-next-line no-unused-vars
function setAuthHeader(restHeader) {
    let headerName = 'Authorization';
    let res;
    _.each(restHeader, h => {
        if (h.$.key === 'Authorization') {
            res = '\n|' + headerName + '|' + h.$.value + '|';
        }
    });
    return res;
}

function setPathVariablesInString(str) {
    // returns the given /{pathVar} as /:path
    function replacer(match, k) {
        var retVal = '\nGiven path ' + k;
        if (match.endsWith('/')) {
            retVal += '/';
        }
        return retVal.replace(/\n+/g, '\n');
    }

    let test = str
        .replace(/\$/g, '')
        .replace(/({|#\()/g, "'+")
        .replace(/([})])/g, "+'");
    if (test.endsWith("'+'\n\n") || test.endsWith("'+'\n")) {
        test = test.replace(/('\+')(?!.*\1)/g, '');
    }
    return test;
}

function varReplacer(match, inParam) {
    return '#(' + inParam.replace(/\s+/g, '_').replace(/-/g, '_') + ')';
}

function varDotReplacer(match, inParam) {
    return (
        '#(' +
        inParam
            .replace(/\s+/g, '_')
            .replace(/-/g, '_')
            .replace(/#/g, '.') +
        ')'
    );
}

function varReplacerInsql(match, inParam) {
    return '\'"+' + inParam.replace(/\s+/g, '_') + '+"\'';
}

function setVariablesInString(str) {
    if (typeof str !== 'string') {
        console.error('variable is not type of string : ', str);
    } else {
        return str
            .replace(/\$\{([a-zA-Z0-9#].+?)\}/g, varReplacer)
            .replace(/#\(#Project#([a-zA-Z0-9#].+?)\)/g, varReplacer)
            .replace(/#\(#TestCase#([a-zA-Z0-9#].+?)\)/g, varReplacer)
            .replace(/#\(([a-zA-Z0-9#].+?)\)/g, varDotReplacer)
            .replace(/}/g, '}');
    }
}

function setVariablesInParmas(str) {
    if (typeof str !== 'string') {
        console.error('variable is not type of string : ', str);
    } else {
        const result = str
            .replace(/\$\{([a-zA-Z0-9#].+?)\}/g, varReplacer)
            .replace(/#\(#Project#([a-zA-Z0-9#].+?)\)/g, varReplacer)
            .replace(/#\(#TestCase#([a-zA-Z0-9#].+?)\)/g, varReplacer)
            .replace(/#\(([a-zA-Z0-9#].+?)\)/g, varDotReplacer)
            .replace(/}/g, '}');
        if (!result.includes('#(')) {
            return "'" + result + "'";
        }
        return result;
    }
}

function setVariablesInSQLString(str) {
    str = str
        .replace(/(\(\s*?SELECT)/gi, 'sqlVarReplacerTemp')
        .replace(/(UNION\s*?SELECT)/gi, 'unionSqlVarReplacerTemp')
        .replace(/(UNION ALL\s*?SELECT)/gi, 'unionAllSqlVarReplacerTemp')
        .replace(/(INTERSECT\s*?SELECT)/gi, 'intersectSqlVarReplacerTemp')
        .replace(/(MINUS\s*?SELECT)/gi, 'minusSqlVarReplacerTemp');

    const noOfQueries = (str.match(/(?:select|Select|SELECT)/g) || []).length;
    for (let i = noOfQueries; i > 1; i--) {
        str = str
            .replace(/(?:select|SELECT|Select)/g, 'SELECT')
            .replace(/SELECT/g, '; SELECT')
            .replace(/;/, '');
    }
    str = str
        .replace(/sqlVarReplacerTemp/g, '(SELECT')
        .replace(/unionSqlVarReplacerTemp/g, 'UNION SELECT')
        .replace(/unionAllSqlVarReplacerTemp/g, 'UNION ALL SELECT')
        .replace(/intersectSqlVarReplacerTemp/g, 'INTERSECT SELECT')
        .replace(/minusSqlVarReplacerTemp/g, 'MINUS SELECT');

    var query = str
        .replace(/^--.*/, '')
        .replace(/--.*/g, ';')
        .replace(/[\r\n]+/g, ' ')
        .replace(
            /(?:With|with)?[\s+]?\((?:\s+|)?(nolock|NOLOCK)(?:\s+|)\)/g,
            ' '
        )
        .replace(/\$\{([a-zA-Z0-9#].+?)\}/g, varReplacer)
        .replace(/#\(#Project#([a-zA-Z0-9#].+?)\)/g, varReplacer)
        .replace(/#\(([a-zA-Z0-9#].+?)\)/g, varReplacerInsql)
        .replace(/''/g, "'")
        .replace(/}/g, '}')
        .replace(/(;(?:;|\s+)+)/g, ';')
        .replace(/'%/g, '%');
    var arrayOfString = query.split(';');
    console.log('converted sql query is ->\n', arrayOfString);
    return arrayOfString;
}

function handleName(str) {
    str = str.replace(/\s+/g, '_').replace(/_+/g, '_');
    let num = str.toString().match(/^\d+_|^_\d+_|^_\d+|^_|^\d+/g);
    return num
        ? str.replace(/^\d+_|^_\d+_|^_\d+|^_|^\d+/g, '') +
              '_' +
              num[0].replace('_', '')
        : str;
}

function setAssertions(request, testStep) {
    let i = 0;
    let scriptTestName = '';
    while (_.has(testStep, 'config.0.restRequest.0.assertion.' + i, null)) {
        const assertion = _.get(
            testStep,
            'config.0.restRequest.0.assertion.' + i,
            null
        );
        if (assertion) {
            let assertionType = _.get(assertion, '$.type', 'Unnamed assertion');
            // eslint-disable-next-line no-unused-vars
            let testName = _.get(assertion, '$.name', 'Unnamed test');
            if (assertionType === 'Valid HTTP Status Codes') {
                const statusCode = _.get(assertion, 'configuration.0.codes.0');
                if (statusCode) {
                    let statusCodes = statusCode.split(',');
                    if (statusCodes.length === 1) {
                        scriptTestName +=
                            'Then status ' +
                            statusCode.replace('\n', '') +
                            '\n';
                    } else {
                        scriptTestName +=
                            'Then assert responseStatus == ' +
                            statusCodes[0].replace('\n', '') +
                            ' || responseStatus == ' +
                            statusCodes[1].replace('\n', '') +
                            '\n';
                    }
                }
            } else if (assertionType === 'Simple Contains') {
                let strTomatch = setVariablesInParmas(
                    _.get(assertion, 'configuration.0.token.0')
                );
                scriptTestName +=
                    'Then match response contains ' + strTomatch + '\n';
            } else if (
                assertionType === 'JsonPath Count' ||
                assertionType === 'JsonPath Match'
            ) {
                let jsonPath = _.get(assertion, 'configuration.0.path.0');
                const expectedValue = _.get(
                    assertion,
                    'configuration.0.content.0'
                );
                scriptTestName +=
                    'Then match response.' +
                    jsonPath +
                    ' contains ' +
                    setVariablesInParmas(expectedValue) +
                    '\n';
            } else if (assertionType === 'JsonPath Existence Match') {
                let jsonPath = _.get(assertion, 'configuration.0.path.0');
                scriptTestName +=
                    'Then match response.' + jsonPath + " == '#notnull'\n";
            } else if (assertionType === 'GroovyScriptAssertion') {
                const scriptText = _.get(
                    assertion,
                    'configuration.0.scriptText.0'
                );
                scriptTestName +=
                    '* def groovyAssertion =\n """\n ' +
                    scriptText +
                    ' \n"""\n';
            } else if (assertionType === 'MessageContentAssertion') {
                /* let assertionType = _.get(
                    assertion,
                    'configuration.0.scriptText.0'
                ); */
            } else if (assertionType === 'Simple Equals') {
                const patternText = _.get(
                    assertion,
                    'configuration.0.patternText.0'
                );
                scriptTestName +=
                    '\n* match reposnse == ' +
                    patternText.replace(/\n/g, ' ') +
                    ' \n';
            } else if (assertionType === 'HTTP Header Exists') {
                const Header = _.get(assertion, 'configuration.0.Header.0');
                scriptTestName +=
                    '\n* match responseHeaders.' + Header + " == '#notnull'\n";
            } else if (assertionType === 'Invalid HTTP Status Codes') {
                const statusCode = _.get(assertion, 'configuration.0.codes.0');
                if (statusCode) {
                    const statusCodes = statusCode.split(',');
                    if (statusCodes.length === 1) {
                        'Then assert responseStatus !== ' + statusCode + '\n';
                    } else {
                        scriptTestName +=
                            'Then assert responseStatus !== ' +
                            statusCodes[0].replace('\n', '') +
                            ' || responseStatus !== ' +
                            statusCodes[1].replace('\n', '') +
                            '\n';
                    }
                }
            } else if (assertionType === 'Simple NotContains') {
                const strTomatch = _.get(assertion, 'configuration.0.token.0');
                scriptTestName +=
                    'Then match response !contains ' + strTomatch + '\n';
            } else if (assertionType === 'HTTP Header Equals') {
                const Header = _.get(assertion, 'configuration.0.Header.0');
                let Value = _.get(assertion, 'configuration.0.Value.0');
                scriptTestName +=
                    '* match responseHeaders.' +
                    Header +
                    ' === ' +
                    Value +
                    '\n';
            }
        }
        i++;
    }

    if (i > 0) {
        request += scriptTestName;
    }
    return request;
}

function setAssertionsINJDBC(request, testStep) {
    let i = 0;
    let scriptTestName = '';
    while (_.has(testStep, 'assertion.' + i, null)) {
        let assertion = _.get(testStep, 'assertion.' + i, null);
        if (assertion) {
            let assertionType = _.get(assertion, '$.type', 'Unnamed assertion');
            // eslint-disable-next-line no-unused-vars
            const testName = _.get(assertion, '$.name', 'Unnamed test');
            if (assertionType === 'Valid HTTP Status Codes') {
                const statusCode = _.get(assertion, 'configuration.0.codes.0');
                if (statusCode) {
                    scriptTestName +=
                        'Then status ' + statusCode.replace('\n', '') + '\n';
                }
            } else if (assertionType === 'Simple Contains') {
                const strTomatch = _.get(assertion, 'configuration.0.token.0');
                scriptTestName +=
                    'Then match response contains ' + strTomatch + '\n';
            } else if (
                assertionType === 'JsonPath Count' ||
                assertionType === 'JsonPath Match'
            ) {
                const jsonPath = _.get(assertion, 'configuration.0.path.0');
                const expectedValue = _.get(
                    assertion,
                    'configuration.0.content.0'
                );
                scriptTestName +=
                    'Then match response.' +
                    jsonPath +
                    ' contains ' +
                    setVariablesInString(expectedValue) +
                    '\n';
            } else if (assertionType === 'GroovyScriptAssertion') {
                let scriptText = _.get(
                    assertion,
                    'configuration.0.scriptText.0'
                );
                scriptTestName +=
                    '* def groovyAssertion =\n """\n ' + scriptText + ' \n"""';
            }
        }
        i++;
    }

    if (i > 0) {
        request += scriptTestName;
    }
    return request;
}

// this is one test case
// this path will be found in a <service folder>/settings.xml
// one test case will be one folder
// let's create requests for each test STEP

function convertTestStepToRequest(testStep, cb) {
    let testType = _.get(testStep, '$.type');
    if (testType === 'restrequest') {
        // basic data
        let name = handleName(_.get(testStep, '$.name'));

        var service = unifyService(_.get(testStep, 'config.0.$.service'));
        var path = _.get(testStep, 'config.0.$.resourcePath');
        var method = _.get(testStep, 'config.0.$.methodName');
        var restRequest = _.get(testStep, 'config.0.restRequest.0');
        var desc = _.get(testStep, 'config.0.restRequest.0.description');

        console.log(
            'Looking for service ' +
                service +
                '  path= ' +
                path +
                '     method = ' +
                method
        );
        if (!servicesMap[service + '||' + path]) {
            console.error(
                'for testStep' +
                    name +
                    '  service map entry for key {' +
                    service +
                    '||' +
                    path +
                    '} is undefine'
            );
        }
        console.log('Smap entry', servicesMap[service + '||' + path]);

        getRequestTemplate(
            service,
            path,
            method,
            restRequest,
            (err, params, data, restRequest) => {
                // data is a resource object
                // TODO: Get the service variable here
                // that + "Base" is to be used in place of originalUrl
                let restHeader = _.get(restRequest, 'parameters.0.entry');
                const parameters = _.get(
                    data,
                    'resource.method.parameters.0.parameter',
                    []
                ) // method-specific params.
                    .concat(_.get(data, 'resource.parameters.0.parameter', []))
                    .concat(_.get(data, 'parameters.0.parameter', []))
                    .concat(_.get(restRequest, 'parameters.0.entry')); // resource-specific params
                const headers = [];
                let pathVars = [];
                let queryParams = [];
                let thisStyle;

                _.each(parameters, p => {
                    if (p) {
                        thisStyle = _.get(p.style, '0');
                        if (thisStyle === 'HEADER') headers.push(p);
                        else if (thisStyle === 'TEMPLATE') pathVars.push(p);
                        else if (thisStyle === 'QUERY') queryParams.push(p);
                        else {
                            console.log('Unknown param style', thisStyle);
                        }
                    } else {
                        console.error('Undefined parameters', p);
                    }
                });

                var restValueshashmap = _.fromPairs(
                    restHeader
                        ? restHeader.map(function(item) {
                              return [item.$.key, item.$.value];
                          })
                        : console.error('Undefined restValues', restHeader)
                );

                let baseUrlForEnv = setVariablesInParmas(
                    _.get(
                        restRequest,
                        'endpoint.0',
                        _.get(
                            data,
                            'resource.method.request.0.endpoint.0',
                            params.service.replace(/\s+/g, '_')
                        )
                    )
                )
                    .replace(/#\(/g, '')
                    .replace(/\)/g, '');
                //params.service.replace(/\s+/g, '_');
                let url =
                    baseUrlForEnv +
                    (params.path
                        ? "\nGiven path '" +
                          setVariablesInString(
                              params.path.replace(/\s+/g, '_')
                          ) +
                          "'"
                        : '') +
                    '\n' +
                    getQueryParams(queryParams, restValueshashmap);
                url = setPathVariablesInString(url).replace(/\n+/g, '\n');

                let pathParamsArray = [];
                let pvKey;
                _.each(pathVars, pv => {
                    if ((pvKey = _.get(pv, 'name.0'))) {
                        pathParamsArray.push({
                            key: pvKey,
                            value: _.get(
                                pv,
                                'default.0',
                                '<no default specified>'
                            ),
                        });
                    }
                });
                // TODO: Get the rest of the stuff through the project, not soapui

                const reqBody = setVariablesInString(
                    _.get(
                        restRequest,
                        'request.0',
                        _.get(data, 'resource.method.request.0.request.0', '')
                    )
                );

                let methodtype = data
                    ? _.get(data, 'resource.method.$.method')
                    : method;
                if (
                    /(?:get|GET|Get)/.test(methodtype) ||
                    /(?:get|GET|Get)/.test(name)
                ) {
                    methodtype = 'GET';
                } else if (
                    /(?:post|POST|Post)/.test(methodtype) ||
                    /(?:post|POST|Post)/.test(name)
                ) {
                    methodtype = 'POST';
                } else if (
                    /(?:put|PUT|Put)/.test(methodtype) ||
                    /(?:put|PUT|Put)/.test(name)
                ) {
                    methodtype = 'PUT';
                } else if (
                    /(?:delete|DELETE|Delete)/.test(methodtype) ||
                    /(?:delete|DELETE|Delete)/.test(name)
                ) {
                    methodtype = 'DELETE';
                } else if (reqBody && reqBody !== '') {
                    methodtype = 'POST';
                }
                // path vars should be added separately
                let request;

                let jsonPayloadFilename = encodeURIComponent(
                    name.replace(/\//g, '') +
                        '_' +
                        service.replace(/(https|http):\/\//g, '') +
                        '_' +
                        method +
                        '_' +
                        (desc || '') +
                        '.json'
                )
                    .replace('s+', '')
                    .replace(/https?%3A%2F%2F/g, '')
                    .replace(/%20/g, '');

                let jsonDirectoryPath = process.env.testSuiteName + 'jsonFiles';
                let jsonFullPath =
                    jsonDirectoryPath + '/' + jsonPayloadFilename;
                if (reqBody) {
                    console.log('Request body is: ' + reqBody);
                    if (!fs.existsSync(jsonDirectoryPath)) {
                        fs.mkdirSync(jsonDirectoryPath);
                    }
                    if (fs.existsSync(jsonFullPath)) {
                        jsonPayloadFilename =
                            jsonPayloadFilename.replace('.json', '') +
                            '_' +
                            Math.floor(Math.random() * 10) +
                            '.json';
                        jsonFullPath =
                            jsonDirectoryPath + '/' + jsonPayloadFilename;
                    }
                    let writeStream = fs.createWriteStream(jsonFullPath);
                    writeStream.write(reqBody);
                    writeStream.end();
                }

                let bluecumberResourcePath =
                    '../../' +
                    jsonFullPath.replace(/\.\/convertedFiles\//g, '');
                //  '../jsonFiles/' + jsonPayloadFilename;

                let pmHeaders = getHeadersForRequest(headers);
                _.each(pmHeaders, h => {
                    console.log(h);
                });

                switch (methodtype) {
                    case 'GET':
                    case 'getEntity':
                        request =
                            'Given url ' +
                            url +
                            '\n' +
                            'When method GET\n' +
                            '* def ' +
                            name +
                            ' = response\n';
                        break;
                    case 'POST':
                    case 'postEntity':
                        request =
                            'Given url ' +
                            url +
                            '\n' +
                            'And request' +
                            " read('" +
                            bluecumberResourcePath +
                            "')" +
                            '\n' +
                            'When method POST\n' +
                            '* def ' +
                            name +
                            ' = response\n';
                        break;
                    case 'DELETE':
                        if (!reqBody) {
                            request =
                                'Given url ' +
                                url +
                                '\n' +
                                'When method delete\n' +
                                '* def ' +
                                name +
                                ' = response\n';
                        } else {
                            request =
                                'Given url ' +
                                url +
                                '\n' +
                                'And request' +
                                " read('" +
                                bluecumberResourcePath +
                                "')" +
                                '\n' +
                                'When method delete\n' +
                                '* def ' +
                                name +
                                ' = response\n';
                        }
                        break;
                    case 'PUT':
                        request =
                            'Given url ' +
                            url +
                            '\n' +
                            'And request' +
                            " read('" +
                            bluecumberResourcePath +
                            "')" +
                            '\n' +
                            'When method put\n' +
                            '* def ' +
                            name +
                            ' = response\n';
                        break;
                    case 'PATCH':
                        request =
                            'Given url ' +
                            url +
                            '\n' +
                            'And request' +
                            " read('" +
                            bluecumberResourcePath +
                            "')" +
                            '\n' +
                            'When method patch\n' +
                            '* def ' +
                            name +
                            ' = response\n';
                        break;
                    default:
                        if (
                            !fs.existsSync(
                                jsonDirectoryPath + '/' + jsonPayloadFilename
                            )
                        ) {
                            request =
                                'Given url ' +
                                url +
                                '\n' +
                                'When method GET\n' +
                                '* def ' +
                                name +
                                ' = response\n';
                        } else {
                            request =
                                'Given url ' +
                                url +
                                '\n' +
                                'And request' +
                                " read('" +
                                bluecumberResourcePath +
                                "')" +
                                '\n' +
                                'When method POST\n' +
                                '* def ' +
                                name +
                                ' = response\n';
                        }
                        break;
                }
                if (request) {
                    const header = setHeaders(headers, restValueshashmap);
                    request = header ? header + request : request;

                    console.log(request);
                    // check for assertions
                    request = setAssertions(request, testStep);
                }
                const ctype = _.get(
                    data,
                    'resource.method.request.0.$.mediaType',
                    'text/plain'
                );
                return cb(null, request);
            }
        );
    } else if (testType === 'groovy') {
        let testScript = _.get(testStep, 'config.0.script.0', '');
        let request = '* def groovy =\n """\n ' + testScript + ' \n"""';
        cb(null, request);
    } else if (testType === 'datasource' || testType === 'jdbc') {
        (headers = []), (pathVars = []), (queryParams = []), (data = {});
        if (testType === 'datasource') {
            var service = _.get(testStep, 'config.0.$.service');
            var path = _.get(testStep, 'config.0.$.resourcePath');
            var method = _.get(testStep, 'config.0.$.methodName');
            var restRequest = _.get(
                testStep,
                'config.0.dataSource.0.configuration.0'
            );
        } else {
            var service = _.get(testStep, 'config.0.$.service');
            var path = _.get(testStep, 'config.0.$.resourcePath');
            var method = _.get(testStep, 'config.0.$.methodName');
            var restRequest = _.get(testStep, 'config.0');
        }

        const testScript = _.get(testStep, 'config.0.script.0', '');
        // assuming we're checking for the previous request's result
        const testTypeLabel = testType === 'datasource' ? 'Datasource' : 'JDBC';
        const requestName =
            'DB Call: ' +
            _.get(testStep, '$.name') +
            ' (' +
            testTypeLabel +
            ')';
        let prePayLoaddata =
            "* def DbUtils = Java.type('com.cvent.automation.common.java.DBUtils')\n";
        prePayLoaddata = prePayLoaddata + '* def db = new DbUtils(dbConfig)\n';
        const postPayloadData =
            '\n* def ' +
            _.get(testStep, '$.name').replace(/\s+/g, '_') +
            ' = db.readRows(query)\n';
        let request = '';
        var queryString = [];
        queryString = setVariablesInSQLString(
            _.get(
                restRequest,
                'query.0',
                _.get(data, 'resource.method.query.0.query.0', '')
            )
        );

        if (queryString.length == 1) {
            request =
                request +
                prePayLoaddata +
                '* def query = "' +
                queryString[0] +
                '"' +
                postPayloadData;
        } else {
            for (var counter = 0; counter < queryString.length; counter++) {
                if (queryString[counter] || queryString[counter] === '') {
                    request =
                        request +
                        '\n' +
                        prePayLoaddata +
                        '* def query = "' +
                        (queryString[counter] ? queryString[counter] : "''") +
                        '"' +
                        postPayloadData;
                }
            }
        }
        request = setAssertionsINJDBC(request, restRequest);
        cb(null, request);
    } else if (testType === 'delay') {
        const delaytime = _.get(testStep, 'config.0.delay.0', '');
        let request = `* call delay(${delaytime})`;
        cb(null, request);
    } else if (testType === 'calltestcase') {
        let config = '';
        var targetTestCase = _.get(testStep, 'config.0.targetTestCase.0');
        var runMode = _.get(testStep, 'config.0.runMode.0');
        config += 'targetTestCase: ' + targetTestCase + '\nrunMode: ' + runMode;
        const request =
            '* var calltestcaseStep ==  \n"""\n' +
            config.toString() +
            '\n"""\n';
        cb(null, request);
    } else if (testType === 'datasink') {
        let typeTest = _.get(testStep, 'config.0.dataSink.0.$.type');
        if (typeTest === 'Property') {
            let config = '';
            const prefix = _.get(
                testStep,
                'config.0.dataSink.0.configuration.0.prefix.0'
            );
            const suffix = _.get(
                testStep,
                'config.0.dataSink.0.configuration.0.suffix.0'
            );
            const content = _.get(
                testStep,
                'config.0.dataSink.0.configuration.0.content.0'
            );
            config += 'testType: ' + testType + '\n';
            config += 'prefix: ' + prefix + '\n';
            config += 'suffix: ' + suffix + '\n';
            config += 'content: ' + content + '\n';
            let i = 0;
            while (
                _.has(testStep, 'config.0.properties.0.property.' + i, null)
            ) {
                const propetiesName = _.get(
                    testStep,
                    'config.0.properties.0.property.' + i + '.name.0'
                );
                const propetiesValue = _.get(
                    testStep,
                    'config.0.properties.0.property.' + i + '.value.0'
                );
                config += `propetiesName: ${propetiesName}\n`;
                config += 'propetiesValue: ' + propetiesValue + '\n';
                i++;
            }
            const request =
                '* var datasinkStep =  \n"""\n' + config + '\n"""\n';
            cb(null, request);
        }
    } else if (testType === 'datagen') {
        let config = '';
        let i = 0;
        while (_.has(testStep, 'config.0.property.' + i, null)) {
            const typeTest = _.get(
                testStep,
                'config.0.property.' + i + '.$.type'
            );
            if (typeTest === 'Number') {
                let name = _.get(testStep, 'config.0.property.' + i + '.name');
                let mode = _.get(testStep, 'config.0.property.' + i + '.mode');
                const shared = _.get(
                    testStep,
                    'config.0.property.' + i + '.shared'
                );
                config +=
                    'Name :' +
                    name +
                    '; Mode : ' +
                    mode +
                    '; Shared :' +
                    shared;
                const start = _.get(
                    testStep,
                    'config.0.property.0.configuration.0.start'
                );
                const end = _.get(
                    testStep,
                    'config.0.property.0.configuration.0.end'
                );
                config += '; Type: Number';
                config += '; start: ' + start;
                config += '; end: ' + end + '\n';
            } else if (typeTest === 'List') {
                const name = _.get(
                    testStep,
                    'config.0.property.' + i + '.name'
                );
                const mode = _.get(
                    testStep,
                    'config.0.property.' + i + '.mode'
                );
                const shared = _.get(
                    testStep,
                    'config.0.property.' + i + '.shared'
                );
                config +=
                    ' Name :' +
                    name +
                    '; Mode : ' +
                    mode +
                    '; Shared :' +
                    shared;
                const value = _.get(
                    testStep,
                    'config.0.property.0.configuration.0.value'
                );
                config += '; Type: Number';
                config += '; value: ' + value + '\n';
            } else if (typeTest === 'Script') {
                let name = _.get(testStep, 'config.0.property.' + i + '.name');
                let mode = _.get(testStep, 'config.0.property.' + i + '.mode');
                let shared = _.get(
                    testStep,
                    'config.0.property.' + i + '.shared'
                );
                config +=
                    ' Name :' +
                    name +
                    '; Mode : ' +
                    mode +
                    '; Shared :' +
                    shared;
                const Script = _.get(
                    testStep,
                    'config.0.property.0.configuration.0.Script'
                );
                config += '; Type: Script ';
                config += '; Script: ' + Script + '\n';
            }
            i++;
        }
        let request =
            '* var datagenStep =  \n"""\n' + config.toString() + '\n"""\n';
        cb(null, request);
    } else if (testType === 'datasourceloop') {
        let config = '';
        var targetStep = _.get(testStep, 'config.0.targetStep.0');
        let discardResults = _.get(testStep, 'config.0.discardResults.0');
        config =
            'targetStep: ' +
            targetStep +
            ' ; discardResults: ' +
            discardResults;
        const request =
            '* var datasourceloopStep =  \n"""\n' +
            config.toString() +
            '\n"""\n';
        cb(null, request);
    } else {
        // we'll need to figure out different ways to handle other types later
        return cb(null, null);
    }
}

function convertTestCaseToFolder(testCase, cb) {
    var folder = [];
    folder.push('@' + _.get(testCase, 'testCase.$.name').replace(/\s+/g, '_'));
    folder.push('Feature: ' + _.get(testCase, 'testCase.$.name'));
    folder.push('Scenario: ' + _.get(testCase, 'testCase.$.name'));
    folder.push("* call read('../../common.feature')");
    console.log(folder.join('\n'));

    // folder pre-script
    let folderProps = _.get(testCase, 'testCase.properties.0.property');
    let folderScript = '// Setting folder-level properties\n';
    let pName;
    _.each(folderProps, fp => {
        if ((pName = _.get(fp, 'name.0'))) {
            pName = '#TestCase#' + pName;
        }
    });

    // loop over test steps
    async.map(
        _.get(testCase, 'testCase.testStep'),
        convertTestStepToRequest,
        (err, results) => {
            _.each(results, r => {
                if (r && typeof r === 'string') {
                    folder.push(r);
                }
            });
            cb(null, folder);
        }
    );
}

function getXmlNodeFromFilePath(path, cb) {
    async.waterfall(
        [
            function(cb) {
                fs.readFile(path, cb);
            },
            function(data, cb) {
                parser.parseString(data, (err, node) => {
                    if (err) {
                        console.log(err);
                    }
                    cb(err, node);
                });
            },
        ],
        cb
    );
}

var parser = new xml2js.Parser({
    tagNameProcessors: [
        function removeConPrefix(name) {
            if (name.indexOf('con:') === 0) {
                return name.substring(4);
            }
            return name;
        },
    ],
});

function getFolderForTestCase(pathToTestCase, cb) {
    async.waterfall(
        [
            function(cb) {
                console.log(pathToTestCase);
                getXmlNodeFromFilePath(pathToTestCase, (err, node) => {
                    cb(err, node);
                });
            },
            function(data, cb) {
                convertTestCaseToFolder(data, cb);
            },
        ],
        cb
    );
}

// path must be to the folder in which you find element.order
function getCollectionForTestSuite(pathToTestSuite, cb) {
    const pathSegments = pathToTestSuite.split('/');
    _.remove(pathSegments, _.isEmpty);
    let suiteName = _.last(pathSegments);
    console.log('Reading element.order');
    fs.readFile(pathToTestSuite + 'element.order', 'utf8', (err, data) => {
        let testCaseFiles;
        try {
            testCaseFiles = data.split('\n');
        } catch (e) {
            throw 'NO Suite Found, check your params.';
        }
        async.each(
            testCaseFiles,
            (testCase, callback) => {
                if (testCase) {
                    getFolderForTestCase(
                        pathToTestSuite + testCase,
                        (err, folder) => {
                            if (!err) {
                                console.log(
                                    'calling callback of getFolderForTestCase. >> ' +
                                        folder
                                );

                                console.log(
                                    'calling callback of getFolderForTestCase.'
                                );
                                testCase =
                                    testCase.substr(
                                        0,
                                        testCase.lastIndexOf('.')
                                    ) + '.feature';
                                // TestSuiteMap[testCase]=

                                const featureDirectoryPath =
                                    './' +
                                    process.env.testSuiteName +
                                    'featureFiles';
                                if (
                                    !fs.existsSync(featureDirectoryPath, {
                                        recursive: true,
                                    })
                                ) {
                                    fs.mkdirSync(featureDirectoryPath);
                                }
                                var writeStream = fs.createWriteStream(
                                    featureDirectoryPath + '/' + testCase
                                );
                                writeStream.on('finish', function() {
                                    console.log('file has been written');
                                });
                                writeStream.write(folder.join('\n'));
                                writeStream.end();
                            }
                            // callback();
                        }
                    );
                } else {
                    // callback();
                }
            },
            function() {
                console.log(
                    'calling call back of async each of get collection for Testtsuite .'
                );
                cb(null, collection);
            }
        );
    });
}

function getSoapUITestSuite(pathToTestSuite, cb) {
    getCollectionForTestSuite(pathToTestSuite, (err, collectionObj) => {
        fs.writeFile(
            pathToTestSuite + 'test.json',
            JSON.stringify(collectionObj.toJSON()),
            (err, data) => {
                console.log(
                    'File written to ' + pathToTestSuite + 'collection.json'
                );
                cb(null);
            }
        );
    });
    cb();
}

function startProcessingServices(cb) {
    const topNode = serviceStack.pop();
    if (!topNode) {
        return cb();
    }
    var serviceName = topNode.$.service;
    var path = topNode.$.path;
    let parentParamObj = Object.assign(
        _.get(topNode, 'method.0.parameters.0', []),
        _.get(topNode, 'parameters.0', [])
    );

    // console.log('Adding to smap: ' + serviceName + '||' + path);
    servicesMap[serviceName + '||' + path] = _.omit(topNode, 'resource');

    _.each(topNode.resource, r => {
        r.$.service = serviceName;
        r.$.path =
            path.endsWith('/') || r.$.path.startsWith('/')
                ? path + r.$.path
                : path + '/' + r.$.path;

        _.set(
            r,
            'parameters.0',
            Object.assign(
                _.get(r, 'method.0.parameters.0', []),
                _.get(r, 'parameters.0', []),
                parentParamObj
            )
        );
        serviceStack.push(r);
    });

    startProcessingServices(cb);
}

function parseProject(pathToProject, testSuiteName) {
    if (!pathToProject.endsWith('/')) {
        pathToProject += '/';
    }
    if (!testSuiteName.endsWith('/')) {
        testSuiteName += '/';
    }
    const convertedFilesFolder = './convertedFiles/';
    if (!fs.existsSync(convertedFilesFolder)) {
        fs.mkdirSync(convertedFilesFolder);
    }
    const testSuiteFolder = convertedFilesFolder + testSuiteName;
    if (!fs.existsSync(testSuiteFolder)) {
        fs.mkdirSync(testSuiteFolder);
    }
    process.env.testSuiteName = testSuiteFolder;
    const testCases = [];
    const pathToTestSuite = path.join(pathToProject, testSuiteName);
    process.env.pathToProject = pathToProject;

    // this is the compositeProject we got
    fs.readdir(pathToProject, (err, allFileList) => {
        if (allFileList.includes('project.content')) {
            fs.readFile(
                path.join(pathToProject, 'project.content'),
                'utf8',
                (err, filelist) => {
                    async.each(
                        filelist.split('\n'),
                        (item, cb) => {
                            if (!item) {
                                return cb();
                            }
                            (function(cb, pathToProject, item) {
                                let resolvedPath = checkFilePath(
                                    pathToProject,
                                    item
                                );
                                getXmlNodeFromFilePath(
                                    resolvedPath.replace(/\\/g, '/'),
                                    (err, node) => {
                                        if (err) {
                                            console.log(
                                                pathToProject +
                                                    item.replace(/\\/g, '/')
                                            );
                                            return cb(err);
                                        }
                                        if (node.resource) {
                                            // it's a service
                                            var itemParts = item.split('\\');
                                            var fileName = itemParts.pop();
                                            var serviceName = itemParts.pop();
                                            // eslint-disable-next-line no-redeclare
                                            var fileName = fileName.substring(
                                                0,
                                                fileName.length - 4
                                            );
                                            node.resource.$.service = serviceName; // to put the serviceName in the node
                                            serviceStack.push(node.resource);
                                        } else if (node.testCase) {
                                            // it's a test case
                                            testCases.push(node.testCase);
                                        } else {
                                            console.log('Unknown node: ', node);
                                        }
                                        cb();
                                    }
                                );
                            })(cb, pathToProject, item);
                        },
                        (err, cb) => {
                            if (err) {
                                console.log('Error', err);
                            } else {
                                console.log(
                                    'All done. Service nodes: ' +
                                        serviceStack.length +
                                        ', testCases nodes: ' +
                                        testCases.length
                                );
                                startProcessingServices(() => {
                                    console.log(
                                        'All services processed: ',
                                        sCount
                                    );
                                    // Start processing tests
                                    // console.log('Tests', testCases);
                                    // we need to aggregate these by folder
                                    // for now, let's just use the SnapshotService folder since we know that's
                                    // the test foler
                                    getSoapUITestSuite(pathToTestSuite, () => {
                                        // envs
                                        const configDirectoryPath =
                                            './convertedFiles/configs';
                                        if (
                                            !fs.existsSync(configDirectoryPath)
                                        ) {
                                            fs.mkdirSync(configDirectoryPath);
                                        }
                                        const commonfile =
                                            '@ignore\nFeature:\n\nScenario:\n';
                                        let delayfunc =
                                            '* def delay = function(millisecond){karate.log("\\n delay for " + millisecond); java.lang.Thread.sleep(millisecond) }\n';
                                        let randomUUIDfunc =
                                            "* def randomUUID = function(){ return java.util.UUID.randomUUID() + '' }\n";
                                        let randomInteger =
                                            '* def randomInteger = function(){ return Math.abs(~~(Math.random() * 9999999999) + 1) }\n';
                                        fs.writeFileSync(
                                            './convertedFiles/common.feature',
                                            commonfile +
                                                delayfunc +
                                                randomUUIDfunc +
                                                randomInteger
                                        );
                                        if (
                                            allFileList.includes('settings.xml')
                                        ) {
                                            getXmlNodeFromFilePath(
                                                pathToProject + 'settings.xml',
                                                (err, root) => {
                                                    let envArray = _.get(
                                                        root,
                                                        'soapui-project.environment'
                                                    );
                                                    let envFile;
                                                    const configfunc =
                                                        "for (var keys in config) {if (config.hasOwnProperty(keys)){replaceVariable(config,keys)}}\n\nfunction replaceVariable(config,keys) {\nif (!config[keys].match(/^#\\(\\w*\\)/g)){return config[keys];}\nconfig[keys] = replaceVariable(config,config[keys].replace(/[^\\w*]/g,''));\nreturn config[keys];\n}";
                                                    let newEnv;
                                                    let envValue;
                                                    _.each(envArray, env => {
                                                        let filedata = '';
                                                        // 	name: env.$.name
                                                        _.each(
                                                            env.service,
                                                            srv => {
                                                                if (
                                                                    (envValue = _.get(
                                                                        srv,
                                                                        'endpoint.0._'
                                                                    ))
                                                                ) {
                                                                    // newEnv.set(srv.$.name + 'Base', envValue);
                                                                    filedata =
                                                                        filedata +
                                                                        "'" +
                                                                        srv.$.name.replace(
                                                                            /\s+/g,
                                                                            '_'
                                                                        ) +
                                                                        "'" +
                                                                        ': ' +
                                                                        "'" +
                                                                        setVariablesInString(
                                                                            envValue
                                                                        ) +
                                                                        "'" +
                                                                        ',\n';
                                                                }
                                                            }
                                                        );
                                                        _.each(
                                                            env.property,
                                                            prop => {
                                                                if (
                                                                    (envValue = _.get(
                                                                        prop,
                                                                        'value.0'
                                                                    ))
                                                                ) {
                                                                    // newEnv.set(prop.name[0], envValue);
                                                                    filedata =
                                                                        filedata +
                                                                        "'" +
                                                                        prop.name[0].replace(
                                                                            /\s+/g,
                                                                            '_'
                                                                        ) +
                                                                        "'" +
                                                                        ': ' +
                                                                        "'" +
                                                                        setVariablesInString(
                                                                            envValue
                                                                        ) +
                                                                        "'" +
                                                                        ',\n';
                                                                }
                                                            }
                                                        );
                                                        envFile =
                                                            configDirectoryPath +
                                                            '/karate-config-' +
                                                            env.$.name +
                                                            '.js';
                                                        const userName =
                                                            process.env
                                                                .userName ||
                                                            'dummy userName';
                                                        let password =
                                                            process.env
                                                                .password ||
                                                            'dummy password';
                                                        let url =
                                                            process.env.url ||
                                                            'dummy url';
                                                        let driverClassName =
                                                            process.env
                                                                .driverClassName ||
                                                            'dummy driverClassName';
                                                        const finalFileData =
                                                            'function() {\n' +
                                                            '  var env = karate.env;\n' +
                                                            '' +
                                                            '  var config = {\n' +
                                                            `'dbConfig': '{ username : ${userName}'` +
                                                            ',\n' +
                                                            `password: '${password}'` +
                                                            ',\n' +
                                                            `url: '${url}'` +
                                                            ',\n' +
                                                            `'driverClassName': '${driverClassName}'` +
                                                            '\n}\n' +
                                                            filedata +
                                                            '};\n' +
                                                            configfunc +
                                                            '\n return config;\n}';

                                                        fs.writeFileSync(
                                                            envFile,
                                                            finalFileData
                                                        );
                                                        console.log(
                                                            'Env File written to ' +
                                                                envFile
                                                        );
                                                    });

                                                    // process.exit(0);
                                                }
                                            );
                                        } else {
                                            process.exit(0);
                                        }
                                    });
                                });
                            }
                        }
                    );
                }
            );
        } else {
            console.log('No project.content found');
        }
        // find project.content
        // that has a list of relative paths (relative to pathToProject)
        // those are the ONLY xml files we need
        // for each file, if it's a con:testCase, store and call getCollectionForTestSuite later (this function will need to be updated)
        // else, parse and store in map
    });
}

function checkFilePath(pathToProject, item) {
    let items = item.split(/\\/g);
    for (let i = 0; i < items.length; i++) {
        fs.readdirSync(pathToProject).forEach(file => {
            if (items[i].toUpperCase() === file.toUpperCase()) {
                items[i] = file;
            }
        });
        pathToProject = path.join(pathToProject, items[i]);
    }
    return pathToProject;
}

module.exports = parseProject;
/*parseProject(
    'testProjectPath',
    'testSuiteName',
);*/

