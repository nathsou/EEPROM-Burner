#!/usr/bin/env node

const SerialPort = require('serialport');
const Burner = require('../lib/Burner.js');
const cli = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const camelCase = require('camelcase');
const progress = require('cli-progress');

cli
  .version('0.0.5')
  .option('-p, --port [port]', "the Arduino's Serial Port")
  .option('-r, --read [file]', 'read data from EEPROM into file, prints to stdout if no file provided')
  .option('-w, --write [file]', 'write a file to the EEPROM, uses -data if no file provided')
  .option('-b, --bin', 'use binary data, defaults to hexadecimal')
  .option('-f, --fill-num [num]', "fill [start] to [start] + [length] with [num], defaults to 0xff (255)", parseNum)
  .option('-c, --fill-char [char]', "fill [start] to [start] + [length] with [char], defaults to 'a'")
  .option('-s, --start-address [addr]', 'Start address of read or write', parseNum)
  .option('-l, --length [addr]', 'number of bytes to read / fill', parseNum)
  .option('-d, --data [string]', 'data used for a write if no file is provided')
  .option('-g, --hide-progress', 'disables the progress-bar')
  .option('-v, --verbose', 'enable logging')
  .parse(process.argv);

let progress_bar;

parseCLI(cli);
//Allows binary, octal, hexadecimal or decimal to be used
function parseNum(str) {
    const bases = {'0b': 2, '0o': 8, '0x': 16};
    const prefix = str.slice(0, 2);

    return parseInt(str, prefix in bases ? bases[prefix] : 10);
}

function getSerialPort(cli) {
    return new Promise((resolve, reject) => {
        if (cli.hasOwnProperty('port')) {
            resolve(cli.port);
            return;
        }
    
        //serial port was not indicated
        //console.log(chalk.magenta('The arduino serial port can be indicated using --port or -p'));
    
        SerialPort.list().then(ports => {
            let formated_ports = [];
            for (let i = ports.length - 1; i >= 0; i--) {
                let port = ports[i];
                formated_ports.push(`${port.comName}${port.manufacturer !== undefined ? ' [' + port.manufacturer + ']' : ''}`);
            }
            formated_ports.push('Exit');

            inquirer.prompt({
                type: 'list',
                message: chalk.underline('Select option ' + getOptionDescription('port', cli)),
                choices: formated_ports,
                name: 'port'
            }).then(ans => {
                if (ans.port === 'Exit') {
                    reject('No port selected');
                }
                resolve(ports[ports.length - formated_ports.indexOf(ans.port) - 1].comName);
            }).catch(err => reject(err));
        }).catch(err => {throw err});
    });
}

function isDef(option) {
    const opt = cli[camelCase(option)];
    return opt !== undefined && opt !== false;
}

async function parseCLI(cli) {

    if (!isDef('read') && !isDef('write') && !isDef('fillChar') && !isDef('fillNum')) {
        console.log(chalk.yellow(chalk.bold('No operation to perform, use --help to see usage')));
        return;
    }

    try {
        let port = new SerialPort(await getSerialPort(cli), {
            baudRate: 115200
        });

        let eeprom = new Burner(port, {
            on_error: err => {
                console.log(chalk.red(chalk.bold(err)));
                process.exit(1);
            },
            on_msg: (msg, type) => {

                switch (type) {
                    case 'progress':
                        if (isDef('hideProgress')) break;
                        if (progress_bar === undefined) {
                            progress_bar = new progress.Bar({
                                stopOnComplete: true,
                                format: '[{bar}] {percentage}% | ETA: {eta}s | {bytes_left}'
                            }, progress.Presets.shades_grey);
                            progress_bar.start(100, 0, { bytes_left: 'N/A' });
                        }
                        progress_bar.update(msg.percentage, {
                            bytes_left: msg.bytes_left
                        });
                        break;

                    case 'stop-progress':
                        if (progress_bar !== undefined) {
                            //progress_bar.stop();
                            //progress_bar = undefined;
                        }
                        break;

                    case 'msg':
                        if (isDef('verbose')) {
                            console.log(chalk.blue(msg));
                        }
                        break;
                }
            },
            send_progress: !isDef('hideProgress')
        });

        if (cli.hex) {
            eeprom.useHexadecimal();
        } else if (cli.bin) {
            eeprom.useBinary();
        }

        port.on('open', () => {
            if (isDef('read')) {
                read(eeprom, cli);
            } else if (isDef('write')) {
                write(eeprom, cli);
            } else if (isDef('fillNum') || isDef('fillChar')) {
                fill(eeprom, cli);
            }
        });
    } catch (err) {
        console.log(chalk.yellow(err));
    }

}

function getOption(option, cli) {
    option = camelCase(option);
    for (let opt of cli.options) {
        if (camelCase(opt.long) === option) {
            return opt;
        }
    }

    return null;
}

function getOptionDescription(option, cli) {
    const opt = getOption(option, cli);
    return `${opt.long} [${opt.short}] : ${opt.description}`;
}

//ensures that [option] is defined (if not provided, we ask the user to enter it explicitly)
function ensureOption(option, cli, parser = v => v) {
    option = camelCase(option);
    return new Promise((resolve, reject) => {
        if (
            cli.hasOwnProperty(option) &&
            typeof cli[option] !== 'boolean' &&
            cli[option] !== null && 
            !isNaN(cli[option])
        ) {
            resolve(cli[option]);
            return;
        }

        const opt = getOption(option, cli);

        inquirer.prompt({
            type: 'input',
            name: 'value',
            message: `Enter a value for ${getOptionDescription(option, cli)} :`
        }).then(v => {
            resolve(parser.call(null, v.value));
        }).catch(err => reject(err));
    })
}

async function read(eeprom, cli) {
        const addr = await ensureOption('start-address', cli, parseNum),
            len = await ensureOption('length', cli, parseNum),
        file_name = cli['read'];

        if (typeof file_name === 'boolean') {
        eeprom.read(addr, len, data => {
            process.stdout.write(chalk.green(data));
        });
    } else {
        eeprom.readToFile(addr, len, file_name);
    }
}

async function write(eeprom, cli) {
    const addr = await ensureOption('start-address', cli, parseNum),
        file_name = cli['write'];

    if (typeof file_name === 'boolean') {
        const data = await ensureOption('data', cli);
        eeprom.writeBuffer(addr, Buffer.from(data));
    } else {
        eeprom.writeFile(addr, file_name);
    }
}

async function fill(eeprom, cli) {
    let char_or_nb;
    if (isDef('fillNum')) { //num
        char_or_nb = (typeof cli['fillNum'] === 'number') ? cli['fillNum'] : 255
    } else { //char
        char_or_nb = (typeof cli['fillChar'] === 'string') ? cli['fillChar'][0] : 'a'
    }
    const addr = await ensureOption('start-address', cli, parseNum),
        len = await ensureOption('length', cli, parseNum);

    eeprom.fill(addr, len, char_or_nb);
}

process.on('unhandledRejection', err => { 
    console.error('Unhandled Rejection: ' + err);
    throw err;
    process.exit(1);
});