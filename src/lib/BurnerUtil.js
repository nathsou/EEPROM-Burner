const fs = require('fs');
const Queue = require('./Queue.js')

const BUFFER_SIZE = 1024;
const STATE = {'IDLE': 0, 'READING': 1, 'WRITING': 2, 'ERROR' : 3, 'FILL': 4, 'PROGRESS': 5};

class BurnerUtil {

    constructor(port, params) {
        this.prev_state = STATE.IDLE;
        this.state = STATE.IDLE;
        this.port = port;
        this.queue = new Queue();

        _merge(this, _default(params, {
            on_error: undefined,
            on_msg: undefined,
            exit_on_empty_queue: true,
            send_progress: true,
            repeat_limit: 3,
            repeat_interval: 1500,
            log_interval: 1000
        }));

        this.port.on('data', data => this.onData.call(this, data));
    }

    log(msg, type = 'msg') {
        if (this.on_msg !== undefined) {
            this.on_msg.call(null, msg, type);
        }
    }

    formatNumber(num, fill_zeroes) {
        let str = (num || 0).toString(16);
        while (str.length < fill_zeroes) {
            str = '0' + str;
        }
        return str;
    }

    setState(state) {
        //console.log('new state: ' + state, 'prev state: ' + this.state);
        this.prev_state = this.state;
        this.state = state;
    }

    nextCommand() {

        //clean things up

        if (this.send_progress) {
            this.log(null, 'stop-progress');
        }

        if (this.repeat_ID !== undefined) {
            clearInterval(this.repeat_ID);
        }

        //end write stream
        if (this.wstream !== undefined) {
            this.wstream.end();
            this.wstream = undefined;
        }

        if (this.queue.empty()) {
            if (this.exit_on_empty_queue) {
                process.exit(0);
            } else { return; }
        }

        let cmd = this.queue.peek();
        this.repeat_cmd = () => {
            if (this.repeat_count++ > this.repeat_limit) {
                this.error('Serial port not responding.');
            }
            this.port.write(this.formatCommand(cmd), 'ascii', err => {
                this.last_cmd = cmd;
                if (err) { this.error(err); }
            });
        };
        this.repeat_count = 0;
        this.repeat_ID = setInterval(this.repeat_cmd, this.repeat_interval);
        this.state = this.prev_state;
    }

    formatCommand(cmd) {
        return '\0' + //begin a new command
                cmd.cmd + //command character
                ',' +
                this.formatNumber(cmd.addr, 4) + //start address
                ',' +
                this.formatNumber(cmd.len, 4) + //data length (bytes)
                ',' +
                (cmd.char !== undefined ? '0' + cmd.char :(cmd.nb !== undefined ? this.formatNumber(cmd.nb, 2) : 0)) + //fill character
                ',' +
                (this.send_progress ? '1' : '0') + //send progress ?
                '\n';
    }

    sendCommand(cmd) {
        this.log(`Added task ${this.formatCommand(cmd).replace(/\n/g, '')} in queue`);
        this.queue.add(cmd);
        if (this.queue.length() === 1) {
            this.nextCommand();
        }
    }

    stopRepeating() {
        if (this.repeat_ID !== undefined) {
            //console.log('stop repeating');
            this.repeat_cmd = undefined;
            clearInterval(this.repeat_ID);
            this.repeat_ID = undefined;
            this.queue.dequeue();
        }
    }

    error(msg) {
        if (this.on_error !== undefined) {
            this.on_error.call(null, msg);
        } else {
            console.error(msg);
            process.exit(1);
        }
    }

    writeToFile(buffer) {
        if (this.wstream === undefined) {
            this.wstream = fs.createWriteStream(this.last_cmd.file_name.trim());
        }

        this.wstream.write(buffer);

        this.log({
                percentage: 100 * (this.wstream.bytesWritten / this.last_cmd.len),
                bytes_left: `[${_clamp(this.wstream.bytesWritten, 0, this.last_cmd.len)} / ${this.last_cmd.len} bytes]`
            }, 'progress'
        );
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

    /*
    * Commands
    */

    read(addr, length, callback, bin = false) {
        this.sendCommand({
            state: STATE.READING,
            cmd: bin ? 'r' : 'R',
            addr: addr,
            len: length,
            callback: callback
        });
    }

    readToFile(addr, length, file_name, bin = false) {
        this.sendCommand({
            state: STATE.READING,
            cmd: bin ? 'r' : 'R',
            addr: addr,
            len: length,
            file_name: file_name
        });
    }

    writeBuffer(addr, buffer, bin = false) {
        this.sendCommand({
            state: STATE.WRITING,
            cmd: bin ? 'w' : 'W',
            addr: addr,
            len: buffer.length,
            buffer: buffer
        });
    }

    writeFile(addr, file_name, bin = false) {
        const len = fs.statSync(file_name).size;

        this.rstream = fs.createReadStream(file_name.trim(), {
            highWaterMark: BUFFER_SIZE
        });

        this.long_task = {
            addr: addr,
            len: len
        };

        this.rstream.on('data', buffer => {
            if (this.written_data_len === undefined) {
                this.written_data_len = 0;
            } else {
                this.written_data_len += buffer.length;
            }
            this.writeBuffer(this.written_data_len, buffer, bin);
        });
    }

    fill(addr, len, char_or_nb) {
        const is_char = typeof char_or_nb === 'string'; 

        this.sendCommand({
            state: STATE.FILL,
            cmd: is_char ? 'F' : 'f',
            addr: addr,
            len: len,
            char: is_char ? char_or_nb : undefined,
            nb: is_char ? undefined : char_or_nb
        });
    }

    /*
    * on command events
    */

    beginError(str, data) {
        this.prev_state = this.state;
        this.setState(STATE.ERROR);
    }

    beginProgress(str, data) {
        this.setState(STATE.PROGRESS);
    }

    beginRead() {
        this.setState(STATE.READING);
        this.stopRepeating();
    }

    beginFill() {
        this.setState(STATE.FILL);
        this.stopRepeating();
    }

    beginWrite() {
        this.setState(STATE.WRITING);
        this.stopRepeating();
        //send data
        if (this.last_cmd.buffer !== undefined) { //Buffer mode
            this.log('writing buffer');
            this.port.write(this.last_cmd.buffer);
        } else {
            this.error('Invalid pong.');
        }
    }

    /*
    * Commands data processing
    */

    processWriteData(str, buffer) {
        //console.log('received: ' + str);

        if (str === '%') {
            this.log('Data successfully written: ' + this.formatCommand(this.last_cmd).replace(/\n/g, ''));
            this.stopRepeating();
            this.nextCommand();
        }
    }


    processErrorData(str, data) {
        if (str === '%') {
            this.error(this.error_msg);
            this.error_msg = undefined;
            this.nextCommand();
        } else { //it's the error message
            this.error_msg = this.error_msg === undefined ? str : this.error_msg + str;
        }
    }

    processProgressData(str, data) {
        if (str === '%') {
            //backup previous state
            this.state = this.prev_state;
        } else {
            const val = parseInt(str);
            const payload = (o => { return {
                percentage: 100 * (val - o.addr) / o.len,
                bytes_left: `[${_clamp(val - o.addr, 0, o.len)} / ${o.len} bytes]`
            }})(
                (this.long_task !== undefined ? this.long_task : this.last_cmd)
            );
                        
            this.log(payload, 'progress');
        }
    }

    processFillData(str, data) {
        if (str === '%') {
            this.nextCommand();
        }
    }

    onData(data) { //split data in separate buffers

        const str = data.toString();//.replace(/\n/g, '');

        //console.log(str);

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

    handleBuffer(str, buffer) {

        //console.log(this.state, str);

        switch (str) {
            case 'beginError':
                this.beginError();
                return;

            case 'beginProgress':
                this.beginProgress();
                return;

            case 'beginRead':
                this.beginRead();
                return;

            case 'beginWrite':
                this.beginWrite();
                return;

            case 'beginFill':
                this.beginFill();
                return;
        }

        switch (this.state) {
            case STATE.PROGRESS:
                this.processProgressData(str, buffer);
                break;

            case STATE.READING:
                this.processReadData(str, buffer);
                break;

            case STATE.WRITING:
                this.processWriteData(str, buffer);
                break;

            case STATE.ERROR:
                this.processErrorData(str, buffer);
                break;

            case STATE.FILL:
                this.processFillData(str, buffer);
                break;

            default:
                this.error(`Unhandled state: ${this.state}`);
                break;
        }
    }

}

//Some little utils

//give an object default values if not supplied
function _default(obj, def) {
    let res = {};
    obj = obj == null ? {} : obj;
    for (let key of Object.keys(def)) {
        res[key] = obj.hasOwnProperty(key) ? obj[key] : def[key];
    }

    return res;
}

//merge dest and obj properties into dest
function _merge(dest, obj) {
    for (let key of Object.keys(obj)) {
        if (!dest.hasOwnProperty(key)) {
            dest[key] = obj[key];
        }
    }
}

function _clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}

module.exports = BurnerUtil;
