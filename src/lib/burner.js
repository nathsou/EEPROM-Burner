const fs = require('fs');

STATE =  {'IDLE': 0, 'READING': 1, 'WRITING': 2, 'ERROR' : 3}; 

class BurnerUtil { //compatible with [AT, ST, ACT]28C[16, 64, 256]

    constructor(port, on_error, on_msg, exit_on_empty_queue = true) {
        this.state = STATE.IDLE;
        this.port = port;
        this.queue = [];
        this.repeat_limit = 3;
        this.repeat_interval = 1500;
        this.exit_on_empty_queue = exit_on_empty_queue;
        this.on_msg_cb = on_msg;
        this.on_error_cb = on_error;

        this.port.on('data', data => this.onData(data));
    }

    log(msg) {
        if (this.on_msg_cb !== undefined) {
            this.on_msg_cb.call(null, msg);
        }
    }

    formatNumber(num, fill_zeroes) {
        let str = num.toString(16);
        while (str.length < fill_zeroes) {
            str = '0' + str;
        }
        return str;
    }

    nextCommand() {

        //clean things up

        if (this.repeat_ID !== undefined) {
            clearInterval(this.repeat_ID);
        }

        //end write stream
        if (this.wstream !== undefined) {
            this.wstream.end();
            this.wstream = undefined;
        }

        if (this.queue.length === 0) {
            if (this.exit_on_empty_queue) {
                process.exit(0);
            } else {
                this.state = STATE.IDLE;
                return;
            }
        }

        let cmd = this.queue[0];
        this.repeat_cmd = () => {
            if (this.repeat_count++ > this.repeat_limit) {
                this.error('Serial port not responding.');
            } 
            this.port.write(this.formatCommand(cmd), 'ascii', err => {
                //this.state = cmd.state;
                this.last_cmd = cmd;
                //console.log(`cmd: ${this.formatCommand(cmd)}`)
                if (err) throw new Error(err);
            });
        };
        this.repeat_count = 0;
        this.repeat_ID = setInterval(this.repeat_cmd, this.repeat_interval);
    }

    formatCommand(cmd) {
        return cmd.cmd + ',' + cmd.args.map(a => this.formatNumber(a, 4)).join(',') + '\n';
    }
 
    sendCommand(cmd) {
        this.log(`Added task ${this.formatCommand(cmd).replace(/\n/g, '')} in queue`);
        this.queue.push(cmd);
        if (this.queue.length === 1) {
            this.nextCommand();
        }
    }

    stopRepeating() {
        if (this.repeat_ID !== undefined) {
            //console.log('stop repeating');
            this.repeat_cmd = undefined;
            clearInterval(this.repeat_ID);
            this.repeat_ID = undefined;
            this.queue.splice(0, 1);
        }
    }

    error(msg) {
        if (this.on_error_cb !== undefined) {
            this.on_error_cb.call(null, msg);
        } else {
            console.error(msg);
            process.exit(1);
        }
    }

    writeToFile(buffer) {
        if (this.wstream === undefined) {
            this.wstream = fs.createWriteStream(this.last_cmd.file_name);
        }
        this.wstream.write(buffer);
    }

    beginRead() {
        this.state = STATE.READING;
        this.stopRepeating();
    }

    processReadData(str, buffer) {
        if (str[str.length - 1] === '%') {
            this.log('Data successfully read');
            this.nextCommand();
        } else {
            if (this.last_cmd.file_name !== undefined) {
                this.writeToFile(buffer);
            } else {
                if (this.last_cmd.callback !== undefined) {
                    this.last_cmd.callback.call(null, str);
                } else {
                    process.stdout.write(str);
                }
            }
        }
    }

    beginWrite() {
        this.state = STATE.WRITING;
        this.stopRepeating();
        //send data
        if (this.last_cmd.buffer !== undefined) { //Buffer mode
            this.port.write(this.last_cmd.buffer);
        } else if (this.last_cmd.file_name !== undefined) {
            this.rstream = fs.createReadStream(this.last_cmd.file_name, {highWaterMark: 1024});
            this.rstream.on('data', buffer => {
                this.port.write(buffer);
            }).on('end', () => {
                this.rstream = undefined;
            });
        } else {
            this.error('Invalid pong.');
        }
    }
 
    processWriteData(str, buffer) {
        //console.log('received: ' + str);

        if (str[str.length - 1] === '%') {
            this.log('Data successfully written');
            this.nextCommand();
        }
    }

    beginError(str, data) {
        this.state = STATE.ERROR;
        this.stopRepeating();
    }

    processErrorData(str, data) {
        if (str[str.length - 1] === '%') {
            this.error(this.error_msg);
            this.error_msg = undefined;
            this.nextCommand();
        } else { //it's the error message
            this.error_msg = this.error_msg === undefined ? str : this.error_msg + str;
        }
    }

    onData(data) { //split data in separate buffers

        const str = data.toString();//.replace(/\n/g, '');

        let buffers = []; 
        // character '/0' separates each command, '%' indicates that a command has terminated
        if (str.includes('\0')) {
            const split = str.split('\0');
            let offset = 0;
            for (let i = 0; i < split.length; i++) {
                buffers.push(Buffer.from(split[i]));
            }
        } else {
            buffers = [data];
        }

        for (let buffer of buffers) {
            const buf_str = buffer.toString();
            if (buf_str.includes('%')) { //command has terminated
                const buf = Buffer.from(buf_str.split('%')[0]);
                this.handleBuffer(buf.toString(), buf);
                this.handleBuffer('%', Buffer.from('%'));
            } else {
                this.handleBuffer(buffer.toString(), buffer);
            }
        }

    }

    handleBuffer(str, data) {

        if (this.state === undefined || this.state === STATE.IDLE) {
            switch (str) {
                case 'beginRead':
                    this.beginRead();
                    break;
                
                case 'beginWrite':
                    this.beginWrite();
                    break;
                
                case 'beginError':
                    this.beginError();
                    break;

                default:
                    this.state = STATE.IDLE;
                    break;
            }
        } else {
            switch (this.state) {
                case STATE.READING:
                    this.processReadData(str, data);
                    break;

                case STATE.WRITING:
                    this.processWriteData(str, data);
                    break;
                
                case STATE.ERROR:
                    this.processErrorData(str, data);
                    break;

                default:
                    this.error(`Unhandled data: ${str}`);
                    break;
            }
        }

    }
}

//Supported chips and their capacity (in bytes)

class Burner {
    constructor(port, on_error, on_msg) {
        this.util = new BurnerUtil(port, on_error, on_msg);
        this.hex = true;
    }

    useHexadecimal() {
        this.hex = true;
    }

    useBinary() {
        this.hex = false;
    }

    read(addr, length, callback) {
        this.util.sendCommand({
            'state': STATE.READING,
            'cmd': this.hex ? 'R' : 'r',
            args: [addr, length],
            callback: callback
        });
    }

    readToFile(addr, length, file_name) {
        this.util.sendCommand({
            'state': STATE.READING,
            'cmd': this.hex ? 'R' : 'r',
            args: [addr, length],
            file_name: file_name
        });
    }

    writeBuffer(addr, buffer) {
        this.util.sendCommand({
            state: STATE.WRITING,
            cmd: this.hex ? 'W' : 'w',
            args: [addr, buffer.length],
            buffer: buffer
        });
    }

    writeFile(addr, file_name) {
        const len = fs.statSync(file_name)['size'];

        this.util.sendCommand({
            state: STATE.WRITING,
            cmd: this.hex ? 'W' : 'w',
            args: [addr, len],
            file_name: file_name
        });
    }

    fill(addr, length, nb) {
        let buf = new Buffer(length);
        buf.fill(nb);
        this.writeBuffer(addr, buf);
    }

}

module.exports = Burner;