const BurnerUtil = require('./BurnerUtil.js');

class Burner {
    constructor(port, params) {
        this.util = new BurnerUtil(port, params);
        this.useHexadecimal();
    }

    useHexadecimal() {
        this.bin = false;
    }

    useBinary() {
        this.bin = true;
    }

    read(addr, length, callback) {
        this.util.read(addr, length, callback, this.bin)
    }

    readToFile(addr, length, file_name) {
        this.util.readToFile(addr, length, file_name, this.bin);
    }

    writeBuffer(addr, buffer) {
        this.util.writeBuffer(addr, buffer, this.bin);
    }

    writeFile(addr, file_name) {
        this.util.writeFile(addr, file_name, this.bin);
    }

    fill(addr, length, char_or_nb) {
        this.util.fill(addr, length, char_or_nb);
    }

}

module.exports = Burner;
