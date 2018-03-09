/**
 * ** project Arduino EEPROM programmer **

   This sketch can be used to read and write data to a
   AT28C64 or AT28C256 parallel EEPROM

   $Author: mario, modified by Nathan Soufflet $
   $Date: 2018/09/03 $
   $Revision: 1.3 $

   This software is freeware and can be modified, reused or thrown away without any restrictions.

   Use this code at your own risk. I'm not responsible for any bad effect or damages caused by this software!

 **/


/*****************************************************************

    COMMUNICATION PROTOCOL

 ****************************************************************/
 
/*
 * There are two formats available: binary and hexadecimal which represents the data as ascii characters
 * The Arduino receives commands from an external controller or master communicating at 2 000 000 bauds via serial 
 * Four commands are currently implemented: Read in binary : 'r', Read in hex : 'R', Write in binary : 'w' and Write in hex : 'W'
 * Each command is represented by a string with the following format: ['W' || 'w' || 'R' || 'r'],addr,length
 * The address and length are 4 hexadecimal digits, so to read the 256 first bytes in rom, one would call 'R,0000,00ff'
 *                                                    
 * Once a command has been received, a confirmation is sent : "BeginRead\0" for a read command and "BeginWrite"\0 for a write command
 * To signal the end of a command, the character '%' is sent. A new command can then be issued.
 */

#define FORCE_INLINE __attribute__((always_inline))

// 74595 shit registers pins
#define DS      A0
#define LATCH   A1
#define CLOCK   A2

#define PORTC_DS      0
#define PORTC_LATCH   1
#define PORTC_CLOCK   2


// eeprom pins
// define the IO lines for the data - bus
#define D0 2
#define D1 3
#define D2 4
#define D3 5
#define D4 6
#define D5 7
#define D6 8
#define D7 9

// define the IO lines for the eeprom control
#define CE A3
#define OE A4
#define WE A5
#define PORTC_CE   3
#define PORTC_OE   4
#define PORTC_WE   5

#define BAUD_RATE 2000000

//a buffer for bytes to burn
#define BUFFERSIZE 1024
byte buffer[BUFFERSIZE];
//command buffer for parsing commands
#define COMMANDSIZE 32
char cmdbuf[COMMANDSIZE];

unsigned int startAddress, endAddress;
unsigned int lineLength, dataLength;

//define COMMANDS
#define NOCOMMAND    0
#define VERSION      1
#define SET_ADDRESS  2

#define READ_HEX    10
#define READ_BIN    11
#define READ_ITL    12

#define WRITE_HEX   20
#define WRITE_BIN   21
#define WRITE_ITL   22

#define READ_LED 11
#define WRITE_LED 12


/*****************************************************************

    CONTROL and DATA functions

 ****************************************************************/

// switch IO lines of databus to INPUT state
void data_bus_input() {
  pinMode(D0, INPUT);
  pinMode(D1, INPUT);
  pinMode(D2, INPUT);
  pinMode(D3, INPUT);
  pinMode(D4, INPUT);
  pinMode(D5, INPUT);
  pinMode(D6, INPUT);
  pinMode(D7, INPUT);
}

//switch IO lines of databus to OUTPUT state
void data_bus_output() {
  pinMode(D0, OUTPUT);
  pinMode(D1, OUTPUT);
  pinMode(D2, OUTPUT);
  pinMode(D3, OUTPUT);
  pinMode(D4, OUTPUT);
  pinMode(D5, OUTPUT);
  pinMode(D6, OUTPUT);
  pinMode(D7, OUTPUT);
}

//set databus to input and read a complete byte from the bus
//be sure to set data_bus to input before
byte read_data_bus() {
  return ((digitalRead(D7) << 7) |
          (digitalRead(D6) << 6) |
          (digitalRead(D5) << 5) |
          (digitalRead(D4) << 4) |
          (digitalRead(D3) << 3) |
          (digitalRead(D2) << 2) |
          (digitalRead(D1) << 1) |
          digitalRead(D0));

}


//write a byte to the data bus
//be sure to set data_bus to output before
void write_data_bus(byte data) {
  //2 bits belong to PORTB and have to be set separtely
  digitalWrite(D6, (data >> 6) & 0x01);
  digitalWrite(D7, (data >> 7) & 0x01);
  //bit 0 to 6 belong to bit 2 to 8 of PORTD
  PORTD = PIND | ( data << 2 );
}

//shift out the given address to the 74hc595 registers
void set_address_bus(unsigned int address) {
  //get high - byte of 16 bit address
  byte hi = address >> 8;
  //get low - byte of 16 bit address
  byte low = address & 0xff;

  //disable latch line
  bitClear(PORTC, PORTC_LATCH);

  //shift out highbyte
  fastShiftOut(hi);
  //shift out lowbyte
  fastShiftOut(low);

  //enable latch and set address
  bitSet(PORTC, PORTC_LATCH);

}

//faster shiftOut function then normal IDE function (about 4 times)
void fastShiftOut(byte data) {
  //clear data pin
  bitClear(PORTC, PORTC_DS);
  //Send each bit of the myDataOut byte MSBFIRST
  for (int i = 7; i >= 0; i--)  {
    bitClear(PORTC, PORTC_CLOCK);
    //--- Turn data on or off based on value of bit
    if ( bitRead(data, i) == 1) {
      bitSet(PORTC, PORTC_DS);
    }
    else {
      bitClear(PORTC, PORTC_DS);
    }
    //register shifts bits on upstroke of clock pin
    bitSet(PORTC, PORTC_CLOCK);
    //zero the data pin after shift to prevent bleed through
    bitClear(PORTC, PORTC_DS);
  }
  //stop shifting
  bitClear(PORTC, PORTC_CLOCK);
}

//short function to set the OE(output enable line of the eeprom)
// attention, this line is LOW - active
void set_oe (byte state) {
  digitalWrite(OE, state);
}

//short function to set the CE(chip enable line of the eeprom)
// attention, this line is LOW - active
void set_ce (byte state) {
  digitalWrite(CE, state);
}

//short function to set the WE(write enable line of the eeprom)
// attention, this line is LOW - active
void set_we (byte state) {
  digitalWrite(WE, state);
}

//highlevel function to read a byte from a given address
byte read_byte(unsigned int address) {
  byte data = 0;
  //set databus for reading
  data_bus_input();
  //first disbale output
  set_oe(HIGH);
  //enable chip select
  set_ce(LOW);
  //disable write
  set_we(HIGH);
  //set address bus
  set_address_bus(address);
  //enable output
  set_oe(LOW);
  data = read_data_bus();

  //disable output
  set_oe(HIGH);

  return data;
}


//highlevel function to write a byte to a given address
//this function uses /DATA polling to get the end of the
//write cycle. This is much faster then waiting 10ms
void fast_write(unsigned int address, byte data) {
  byte cyclecount = 0;

  //first disbale output
  set_oe(HIGH);

  //disable write
  set_we(HIGH);

  //set address bus
  set_address_bus(address);

  //set databus to output
  data_bus_output();

  //set data bus
  write_data_bus(data);

  //enable chip select
  set_ce(LOW);

  //wait some time to finish writing
  delayMicroseconds(1);

  //enable write
  set_we(LOW);

  //wait some time to finish writing
  delayMicroseconds(1);

  //disable write
  set_we(HIGH);

  data_bus_input();

  set_oe(LOW);

  while (data != read_data_bus()) {
    cyclecount++;
  };

  set_oe(HIGH);
  set_ce(HIGH);

}



/************************************************

   COMMAND and PARSING functions

 *************************************************/

//waits for a string submitted via serial connection
//returns only if linebreak is sent or the buffer is filled
void readCommand() {
  //first clear command buffer
  for (int i = 0; i < COMMANDSIZE; i++) cmdbuf[i] = 0;
  //initialize variables
  char c;
  int idx = 0;
  //now read serial data until linebreak or buffer is full
  do {
    if (Serial.available()) {
      c = Serial.read();
      cmdbuf[idx++] = c;
    }
  }
  while (c != '\n' && idx < (COMMANDSIZE)); //save the last '\0' for string end
  //change last newline to '\0' termination
  cmdbuf[idx - 1] = 0;
}

//parse the given command by separating command character and parameters
//at the moment only 5 commands are supported

byte parseCommand() {

  //set ',' to '\0' terminator (command string has a fixed strucure)
  //first string is the command character
  cmdbuf[1]  = 0;
  //second string is start address (4 bytes)
  cmdbuf[6]  = 0;
  //third string is data length (4 bytes)
  cmdbuf[11] = 0;
  //fourth string is line length (2 bytes)
  cmdbuf[14] = 0;
  startAddress = hexWord(cmdbuf + 2);
  dataLength = hexWord(cmdbuf + 7);
  lineLength = 16; hexByte(cmdbuf + 12);
  byte retval = 0;
  switch (cmdbuf[0]) {
    case 'A':
      retval = SET_ADDRESS;
      break;
    case 'R':
      retval = READ_HEX;
      break;
    case 'r':
      retval = READ_BIN;
      break;
    case 'W':
      retval = WRITE_HEX;
      break;
    case 'w':
      retval = WRITE_BIN;
      break;
    case 'V':
      retval = VERSION;
      break;
    default:
      retval = NOCOMMAND;
      break;
  }

  return retval;
}

/************************************************************
   convert a single hex digit (0-9,a-f) to byte
   @param char c single character (digit)
   @return byte represented by the digit
 ************************************************************/
byte hexDigit(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  else if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  else if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  else {
    return 0;   // getting here is bad: it means the character was invalid
  }
}

/************************************************************
   convert a hex byte (00 - ff) to byte
   @param c-string with the hex value of the byte
   @return byte represented by the digits
 ************************************************************/
byte hexByte(char* a) {
  return ((hexDigit(a[0]) * 16) + hexDigit(a[1]));
}

/************************************************************
   convert a hex word (0000 - ffff) to unsigned int
   @param c-string with the hex value of the word
 ************************************************************/
unsigned int hexWord(char* data) {
  return ((hexDigit(data[0]) * 4096) +
          (hexDigit(data[1]) * 256) +
          (hexDigit(data[2]) * 16) +
          (hexDigit(data[3])));
}


/************************************************

   INPUT / OUTPUT Functions

 *************************************************/


/**
   read a data block from eeprom and write out a hex dump
   of the data to serial connection
   @param from       start address to read fromm
   @param to         last address to read from
   @param linelength how many hex values are written in one line
 **/
void read_block(unsigned int from, unsigned int dataLength, int linelength) {
  //Serial.println("from: " + String(from) + ", to: " + String(to));
  //count the number fo values that are already printed out on the
  //current line
  int outcount = 0;
  //loop from "from address" to "to address" (included)
  unsigned int addr = from;
  for (unsigned int i = 0; i <= dataLength; i++, addr++) {
    if (outcount == 0) {
      //print out the address at the beginning of the line
      Serial.println();
      Serial.print("0x");
      printAddress(addr);
      Serial.print(" : ");
    }
    //print data, separated by a space
    printByte(read_byte(addr));
    Serial.print(" ");
    outcount = (++outcount % linelength);

  }
  //print a newline after the last data line
  Serial.println();

}

/**
   read a data block from eeprom and write out the binary data
   to the serial connection
   @param from       start address to read fromm
   @param to         last address to read from
 **/
void read_binblock(unsigned int from, unsigned int to) {
  for (unsigned int address = from; address <= to; address++) {
    Serial.write(read_byte(address));
  }
}

/**
   write a data block to the eeprom
   @param address  startaddress to write on eeprom
   @param buffer   data buffer to get the data from
   @param len      number of bytes to be written
 **/
void write_block(unsigned int address, byte* buffer, int len) {
  for (unsigned int i = 0; i < len; i++) {
    fast_write(address + i, buffer[i]);
  }
}


/**
   print out a 16 bit word as 4 character hex value
 **/
void printAddress(unsigned int address) {
  if (address < 0x0010) Serial.print("0");
  if (address < 0x0100) Serial.print("0");
  if (address < 0x1000) Serial.print("0");
  Serial.print(address, HEX);

}

/**
   print out a byte as 2 character hex value
 **/
void printByte(byte data) {
  if (data < 0x10) Serial.print("0");
  Serial.print(data, HEX);
}





/************************************************

   MAIN

 *************************************************/
void setup() {
  //define the shiuftOut Pins as output
  pinMode(DS, OUTPUT);
  pinMode(LATCH, OUTPUT);
  pinMode(CLOCK, OUTPUT);

  //define the EEPROM Pins as output
  // take care that they are HIGH
  digitalWrite(OE, HIGH);
  pinMode(OE, OUTPUT);
  digitalWrite(CE, HIGH);
  pinMode(CE, OUTPUT);
  digitalWrite(WE, HIGH);
  pinMode(WE, OUTPUT);

  pinMode(READ_LED, OUTPUT);
  pinMode(WRITE_LED, OUTPUT);

  //set speed of serial connection
  Serial.begin(BAUD_RATE);
}

/* Read ascii encoded hexadecimal data to the rom
 * the startAddress and dataLength global variables must be set properly beforehand
 */
void readHex() {
  digitalWrite(READ_LED, HIGH);
  Serial.print("beginRead");
  Serial.write('\0');
  //set a default if needed to prevent infinite loop
  if (lineLength == 0) lineLength = 32;
  read_block(startAddress, dataLength, lineLength);
  digitalWrite(READ_LED, LOW);
  Serial.write('%');
}

/* Read binary data from the rom
 * the startAddress and dataLength global variables must be set properly beforehand
 */
void readBin() {
  digitalWrite(READ_LED, HIGH);
  Serial.print("beginRead");
  Serial.write('\0');
  read_binblock(startAddress, dataLength);
  digitalWrite(READ_LED, LOW);
  Serial.write('%');
}

/* Write binary data to the rom
 * the startAddress and dataLength global variables must be set properly beforehand
 */
void writeBin() { //TODO: Implement binary write
  writeHex();
}

/* Write ascii encoded hexadecimal data to the rom
 * the startAddress and dataLength global variables must be set properly beforehand
 */
void writeHex() {
  digitalWrite(WRITE_LED, HIGH);
  Serial.print("beginWrite");
  Serial.write('\0');
  int bytes_left;
  while (dataLength > 0) {
    bytes_left = min(dataLength, BUFFERSIZE);
    Serial.readBytes(buffer, bytes_left);
    write_block(startAddress, buffer, dataLength);
    dataLength -= bytes_left;
  }
  Serial.write('%');
  digitalWrite(WRITE_LED, LOW);
}

/**
   main loop, that runs invinite times, parsing a given command and
   executing the given read or write requestes.
 **/
void loop() {
  readCommand();
  byte cmd = parseCommand();
  switch (cmd) {
    case SET_ADDRESS:
      // Set the address bus to an arbitrary value.
      // Useful for debugging shift-register wiring, byte-order.
      // e.g. A,00FF
      Serial.print("Setting address bus to 0x");
      Serial.println(cmdbuf + 2);
      set_address_bus(startAddress);
      break;
    case READ_HEX:
      readHex();
      break;
    case READ_BIN:
      readBin();
      break;
    case WRITE_BIN:
      writeBin();
      break;

    case WRITE_HEX:
      writeHex();
      break;
    default:
      break;
  }


}





