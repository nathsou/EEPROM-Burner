const fs = require('fs');

STATE =  {'IDLE': 0, 'READING': 1, 'WRITING': 2}; 

class AT28C256BurnerUtil { //compatible with [AT, ST, ACT]28C[16, 64, 256]

    constructor(port, on_error, on_msg, exit_on_empty_queue = true) {
        this.state = STATE.IDLE;
        this.port = port;
        this.queue = [];
        this.repeat_limit = 3;
        this.repeat_interval = 1500;
        this.exit_on_empty_queue = exit_on_empty_queue;
        this.pong_received = false;
        this.on_msg_cb = on_msg;
        this.o_error_cb = on_error;

        this.port.on('data', data => this.onData(data));
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
                this.processFatalError('Serial port not responding.');
            } 
            this.port.write(this.formatCommand(cmd), 'ascii', err => {
                this.state = cmd.state;
                this.last_cmd = cmd;
                this.pong_received = false;
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
        //console.log(`Added task ${this.formatCommand(cmd).replace(/\n/g, '')} in queue`);
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

    processFatalError(msg) {
        if (this.on_error_cb !== undefined) {
            this.on_error_cb.call(null, msg);
        } else {
            console.error('Fatal Error: ' + msg);
            process.exit(1);
        }
    }

    writeToFile(buffer) {
        if (this.wstream === undefined) {
            this.wstream = fs.createWriteStream(this.last_cmd.file_name);
        }
        this.wstream.write(buffer);
    }

    processRead(str, buffer) {
        if (!this.pong_received && (str.length >= 9 && str.slice(0, 9) === 'beginRead')) {
            //console.log('Read pong received: ' + str);
            
            this.stopRepeating();
            //console.log('Pong is valid!');
            this.pong_received = true; //prevents catching strings beginning with 'r' or 'R'
            return;
            
        } else if (str[str.length - 1] === '%') {
            //console.log('Data successfully read');
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

    processWrite(str, buffer) {
        //console.log('received: ' + str);

        if (!this.pong_received && (str.length >= 10 && str.slice(0, 10) === 'beginWrite')) {
            this.stopRepeating();
            this.pong_received = true;
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
                console.error('Invalid pong.');
            }
        } else if (str[str.length - 1] === '%') {
            //console.log('Data successfully written');
            this.nextCommand();
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
        switch (this.state) {
            case STATE.READING:
                this.processRead(str, data);
                break;

            case STATE.WRITING:
                this.processWrite(str, data);
                break;
            
            default:
                console.error(`Unhandled data: ${str}`);
                break;
        }
    }
}

class Burner {
    constructor(port, on_error, on_msg) {
        this.util = new AT28C256BurnerUtil(port, on_error, on_msg);
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
        this.util.sendCommand({
            state: STATE.WRITING,
            cmd: this.hex ? 'W' : 'w',
            args: [addr, fs.statSync(file_name)['size']],
            file_name: file_name
        });
    }

}

module.exports = Burner;