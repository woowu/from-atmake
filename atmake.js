#!/usr/bin/node --harmony
"use strict";
const fs = require('fs');
const path = require('path');
const shell = require('shelljs');
const parser = require('fast-xml-parser');

const DEBUG_CONFIG_INDEX = 2;
var projName;

var argv = require('yargs')
    .option('prj', {
        alias: 'j',
        describe: 'atmel project file',
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
    .option('prj-dir', {
        alias: 'd',
        describe: 'project dir related to build dir',
        default: '..',
        nargs: 1,
        demandOption: true,
    })
    .argv;

function readProjXml(cb)
{
    function getJson(str)
    {
        if (! parser.validate(str)) {
            console.error('data invalid');
            return null;
        }
        return parser.parse(str, {ignoreAttributes: false, attributeNamePrefix : "@_"});
    }
    fs.readFile(argv.prj, (err, data) => {
        if (err) return cb(err);
        cb(null, getJson(data.toString()));
    });
}


function fixPath(p)
{
    const repRules = [
        {
            pattern: /\\/g,
            replacer: '/',
        },
        {
            pattern: /%24\(PackRepoDir\)/g,
            replacer: argv['atmel-packs'],
        },
        {
            pattern: /%24\(ProjectDir\)/g,
            replacer: argv['prj-dir'],
        },
    ];
    repRules.forEach(r => {
        p = p.replace(r.pattern, r.replacer);
    });
    return p;
}

function extractProjConfig(proj, cb)
{
    var root = proj.Project.PropertyGroup[DEBUG_CONFIG_INDEX]
        .ToolchainSettings.ArmGccCpp;
    var value;

    projName = proj.Project.PropertyGroup[0].Name;

    var cOptions = {}, cxxOptions = {};
    ['armgcc', 'armgcccpp'].forEach(name => {
        var defs = '';
        value = root[name + '.compiler.symbols.DefSymbols'].ListValues.Value;
        if (typeof value == 'string')
            defs = '-D' + value;
        else
            value.forEach(v => {
                defs += '-D' + v + ' ';
            });
        defs = defs.trim();

        var optimize = '';
        if (root[name + '.compiler.optimization.level'])
            optimize = root[name + '.compiler.optimization.level'].match(/.*\((.*)\)/)[1];
        var debug = '';
        if (root[name + '.compiler.optimization.DebugLevel'])
            debug = root[name + '.compiler.optimization.DebugLevel'].match(/.*\((.*)\)/)[1];
        var others = root[name + '.compiler.miscellaneous.OtherFlags'];

        var inc = '';
        root[name + '.compiler.directories.IncludePaths'].ListValues.Value
            .forEach(d => {
                inc += '-I' + fixPath(d) + ' ';
            });

        Object.assign(name == 'armgcc' ? cOptions : cxxOptions,
            {
                defs,
                inc: inc.trim(),
                optimize,
                debug,
                others,
            });
    });

    var lib = '';
    value = root['armgcccpp.linker.libraries.Libraries'].ListValues.Value;
    if (typeof value == 'string')
        lib = '-l' + value.slice(3);
    else
        value.forEach(v => {
            lib += '-l' + v.slice(3) + ' ';
        });

    var lpath = '';
    root['armgcccpp.linker.libraries.LibrarySearchPaths'].ListValues.Value
        .forEach(d => {
            lpath += '-L' + fixPath(d) + ' ';
        });

    const flags = root['armgcccpp.linker.miscellaneous.LinkerFlags'];

    const linkOptions = {
        lpath: lpath.trim(),
        lib: '-Wl,--start-group ' + lib.trim() + ' -Wl,--end-group -Wl,--gc-sections',
        flags,
    };

    const cSources = [];
    const cxxSources = [];
    proj.Project.ItemGroup[0].Compile.forEach(item => {
        if (item.SubType != 'compile') return;
        var file = fixPath(item['@_Include']);
        if (file.split('.').slice(-1)[0] == 'c')
            cSources.push(path.join(argv['prj-dir'], file));
        else if (file.split('.').slice(-1)[0] == 'cpp')
            cxxSources.push(path.join(argv['prj-dir'], file));
    });

    return {
        cSources,
        cxxSources,
        cOptions,
        cxxOptions,
        linkOptions,
    };
}

function generateMakefile(proj)
{
    const stream = fs.createWriteStream(projName + '.mk');

    function cOptionsToString(options)
    {
        return options.inc;
    }

    function linkOptionsToString(options)
    {
        return options.lpath + ' ' + options.lib + ' ' + options.flags;
    }

    stream.on('open', () => {
        stream.write('PRG_NAME += ' + projName + '\n');
        stream.write('CFLAGS += ' + cOptionsToString(proj.cOptions) + '\n');
        stream.write('CXXFLAGS += ' + cOptionsToString(proj.cxxOptions) + '\n');
        stream.write('C_SRC += ' + proj.cSources.join(' ') + '\n\n');
        stream.write('CXX_SRC += ' + proj.cxxSources.join(' ') + '\n\n');
        stream.end();
    });
}

readProjXml((err, proj) => {
    if (err) return console.error(err);
    const config = extractProjConfig(proj);
    fs.writeFile(projName + '.json', JSON.stringify(proj, null, 4)
        , err => ! err || console.error(err));
    generateMakefile(config);
});

