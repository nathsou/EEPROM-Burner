## Arduino EEPROM Burner

[!Node CLI](res/cli-demo.gif)

This repository provides a node.js CLI to read from and write to an AT28C[16 || 64 || 128 || 256] parallel EEPROM using an Arduino and a simple serial protocol.

The address is shifted onto two serial-in / parallel-out 8-bit shift registers (74595) to account for the limited amount of pins available.

### Pinout

The pinout can be edited directly in the .ino file.

| Pin Name      | Componenet |   Function                | Arduino Pin |
| ------------- |:----------:|:-------------------------:| -----------:|
| DS            | 74HC595    | Address shift input       | A0          |
| LATCH         | 74HC595    | Address output enable     | A1          |
| CLOCK         | 74HC595    | Shift clock               | A2          |
| CE            | EEPROM     | Chip Enable               | A3          |
| OE            | EEPROM     | Data Output Enable        | A4          |
| WE            | EEPROM     | Data Write Enable         | A5          |
| IO[0..7]      | EEPROM     | Data Input / Output pins  | 2..9        |
| Read LED      | LED        | Optional Read Status LED  | 11          |
| Write LED     | LED        | Optional Write Status LED | 12          |

My breadboard implementation is quite bushy right now, I'm planning on designing a clean PCB version.

[!BreadBoard circuit](res/breadboard-eeprom-burner.jpg)

##Command Line Interface

One can read from or read to the EEPROM using a simple node.js CLI.

[!CLI Usage](res/cli-usage.png)

##Communication Protocol

This simple protocol uses a baud rate of 2 000 000 (can be modified) to issue commands and send/receive data.

- Four commands are currently implemented: Read in binary : 'r', Read in hex : 'R', Write in binary : 'w' and Write in hex : 'W'
- Each command is represented by a string with the following format: ['W' || 'w' || 'R' || 'r'],addr,length  
- The address and length arguments are 4 ascii encoded hexadecimal digits, so to read the 256 first bytes in rom, one would call 'R,0000,00ff'

- Once a command has been received, a confirmation is sent : "BeginRead\0" for a read command and "BeginWrite"\0 for a write command. The master can then start sending data or reading it.

- To signal the end of a command, the character '%' is sent. A new command can then be issued.

## Credits
- [mkeller0815's MEEPROMMER](https://github.com/mkeller0815/MEEPROMMER) from which the .ino file is based
- [Build an Arduino EEPROM programmer](https://www.youtube.com/watch?v=K88pgWhEb1M&feature=youtu.be) by Ben Eater