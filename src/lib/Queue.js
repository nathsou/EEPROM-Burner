
class Queue {
    constructor() {
        this.elems = [];
    }

    length() {
        return this.elems.length;
    }

    empty() {
        return this.length() == 0;
    }

    add(elem) {
        this.elems.push(elem);
    }

    peek() {
        return this.elems[0];
    }

    dequeue() {
        return this.elems.splice(0, 1);
    }
}

module.exports = Queue;