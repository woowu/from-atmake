#!/usr/bin/node --harmony
"use strict";
const readline = require('readline');
const shell = require('shelljs');
const fs = require('fs');

/**
 * Read in a Atmel Studio Makefile, translate it into
 * a Linux compatiable Makefile. It also create
 * required directory structure required by the
 * Makefile to make the make possible.
 *
 * The original Makefile will be read from stdin, and 
 * the translated Makefile will print out to stdout.
 * The directory tree will be created under the root
 * that specified by the '-d' option.
 */

var argv = require('yargs')
    .option('dir', {
        alias: 'd',
        describe: 'the root of build directory',
        default: '.',
        nargs: 1,
        demandOption: true,
    })
    .option('atmel-packs', {
        alias: 'p',
        describe: 'atmel packs directory',
        default: '/opt/atmel/packs',
        nargs: 1,
        demandOption: true,
    })
    .argv;

const atmelPacksDir = argv.p;
const rl = readline.createInterface({
    input: process.stdin,
});

const repRules = [
    {
        pattern: /C:\\.*\\bin\\/g,
        replacer: '',
    },
    {
        pattern: /\.exe/,
        replacer: '',
    },
    {
        pattern: /-L"\.\.\\\\Device_Startup"\s+/,
        replacer: '',
    },
    {
        pattern: /(^.*)\$\(QUOTE\)(.*)\$\(QUOTE\)(.*)$/,
        replacer: '$1$2$3',
    },
    {
        pattern: /C:\\Program Files \(x86\)\\Atmel\\Studio\\7\.0\\Packs/g,
        replacer: atmelPacksDir,
    },
    {
        pattern: /^.*arm-none.*-I.*$/,
        replacer: (match, offset, string) => {
            return string.replace(/\\/g, '/');
        },
    },
    {
        pattern: /^.*arm-none.*-L.*$/,
        replacer: (match, offset, string) => {
            return string.replace(/\\/g, '/');
        },
    },
    {
        pattern: /@".*ld_ar.mk"/,
        replacer: '@ld_ar.mk',
    },
];

const removePatterns = [
    /SHELL := cmd/,
    /QUOTE :=/,
];

const dirSet = new Set();
const objSet = new Set();

function extractBuildDir(line)
{
    const p = /^([^\s:]+)\/[^\s]+\.o\b/;
    const m = line.match(p);
    if (m)
        dirSet.add(m[1]);
}

function accuObjList(line)
{
    const p = /^([^\s:]+\.o)\b/;
    const m = line.match(p);
    if (m)
        objSet.add(m[1])
}

rl.on('line', line => {
    line = line.trimEnd();
    for (var i = 0; i < removePatterns.length; ++i) {
        if (line.match(removePatterns[i]))
            return;
    }
    repRules.forEach(r => {
        line = line.replace(r.pattern, r.replacer);
    });
    extractBuildDir(line);
    accuObjList(line);
    console.log(line);
}).on('close', () => {
    dirSet.forEach(d => {
        shell.mkdir('-p', d);
    });
    fs.writeFile('ld_ar.mk', Array.from(objSet).join(' '), (err) => {
        if (err) console.error(err);
    });
});
