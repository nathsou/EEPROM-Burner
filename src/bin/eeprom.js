#!/usr/bin/env node
 
const SerialPort = require('serialport');
const Burner = require('../lib/AT28C256-burner.js');
const cli = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const camelCase = require('camelcase');

cli
  .version('0.1.0')
  .option('-p, --port [port]', "The Arduino's Serial Port")
  .option('-v, --verbose', 'Verbose mode')
  .option('-b, --bin', 'Use binary data')
  .option('-h, --hex', 'Use hexadecimal data (Intel HEX)')
  .option('-r, --read [file]', 'Read data from EEPROM into file, prints to stdout if no file provided')
  .option('-w, --write [file]', 'Write a file to the EEPROM, uses -data if no file provided')
  .option('-s, --start-address [addr]', 'Start address of read or write', parseStr)
  .option('-l, --read-length [addr]', 'Number of bytes to read', parseStr)
  .option('-d, --data [string]', 'Data used for a write if no file is provided')
  .parse(process.argv);

parseCLI(cli);

//Allows binary, octal, hexadecimal or decimal to be used
function parseStr(str) {
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
                choices: formated_ports, //On mac the bluetooth port is first
                name: 'port'
            }).then(ans => {
                if (ans.port === 'Exit') {
                    reject('No port selected');
                }
                resolve(ans.port);
            }).catch(err => reject(err));
        }).catch(err => {throw err});
    });
}

async function parseCLI(cli) {

    if (!cli.read && !cli.write) {
        console.log(chalk.yellow('No operation to perform, use --help to see usage'));
        process.exit(0);
    }

    try {
        let port = new SerialPort(await getSerialPort(cli), {
            baudRate: 2000000
        });

        let eeprom = new Burner(port, err => {
            console.log(chalk.red(err));
            process.exit(1);
        }, msg => {
            console.log(chalk.blue(msg));
        });

        if (cli.hex) {
            eeprom.useHexadecimal();
        } else if (cli.bin) {
            eeprom.useBinary();
        }

        port.on('open', () => {
            if (cli.read) {
                read(eeprom, cli);
            } else {
                write(eeprom, cli);
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
        if (cli.hasOwnProperty(option)) {
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
        const addr = await ensureOption('start-address', cli, parseStr),
        len = await ensureOption('readLength', cli, parseStr),
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
    const addr = await ensureOption('start-address', cli, parseStr),
        file_name = cli['write'];

    if (typeof file_name === 'boolean') {
        const data = await ensureOption('data', cli);
        eeprom.writeBuffer(addr, Buffer.from(data));
    } else {
        eeprom.writeFile(addr, file_name);
    }
}

process.on('unhandledRejection', err => { 
    console.error('Unahndled Rejection: ' + err);
    process.exit(1);
})
