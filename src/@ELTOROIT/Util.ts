// import { Result } from "@salesforce/command";
// import { cli } from 'cli-ux';
// import { UX } from '@salesforce/cli-plugins-testkit';
// import { Result, UX } from '@salesforce/core';
// import { Table } from '@oclif/core';
import { Logger, SfError } from '@salesforce/core';
// import { Table } from '@oclif/core';
// import { SfCommand } from '@salesforce/sf-plugins-core';

// TRACE is just for making sure the code works.
export enum LogLevel {
  TRACE = 1,
  DEBUG = 2,
  INFO = 3,
  WARN = 4,
  ERROR = 5,
  FATAL = 6,
}

export type ILogger = {
  entryNumber: string;
  level: string;
  lineNumber: string;
  timestamp: string;
  description: string;
};

type TableOutput = {
  data: ILogger[];
  columns: Array<keyof ILogger>;
};

// TODO: Create a function that returns the logs filtered so you only see WARN and above.
// TODO: Create another function that sumarizes the logs {FATAL: 0, ERROR: 3, WARN: 10, INFO: ...
// TODO: Have a "silent" mode for CI/CD that returns the summary of errors.

export class Util {
  public static isAborted = false;
  public static abortedCounter = 0;

  private static counter = 0;
  private static entries: ILogger[] = [];
  private static desiredLogLevel: LogLevel;

  public static async assert(condition: boolean, msg: string): Promise<void> {
    if (!condition) {
      await this.throwError(`ASSERT failed: ${msg}`);
    }
  }

  public static async assertEquals<T>(expected: T, actual: T, msg: string): Promise<void> {
    if (expected !== actual) {
      await this.throwError(`ASSERT failed: ${msg}: Expected: ${String(expected)}, Actual: ${String(actual)}`);
    }
  }

  public static async assertNotEquals<T>(expected: T, actual: T, msg: string): Promise<void> {
    if (expected === actual) {
      await this.throwError(`ASSERT failed: ${msg}: Same value: ${String(expected)}`);
    }
  }

  public static async throwError(msg: unknown): Promise<never> {
    this.isAborted = true;
    this.abortedCounter++;

    if (msg) {
      await Promise.all([
        this.writeLog(`*** Abort Counter: ${this.abortedCounter} ***`, LogLevel.FATAL),
        this.writeLog(msg, LogLevel.FATAL),
      ]).catch((error) => {
        throw new SfError(String(error), 'Error', [], -1);
      });
    }

    throw new SfError(String(msg), 'Error', [], -1);
  }

  public static async setLogLevel(desiredLogLevel: keyof typeof LogLevel): Promise<void> {
    const logLevel = LogLevel[desiredLogLevel];

    if (!(logLevel in LogLevel)) {
      await this.throwError(`ERROR: Level [${LogLevel[desiredLogLevel]}] not available for logging`);
    }

    this.desiredLogLevel = logLevel;
  }

  public static async writeLog(message: unknown, level: LogLevel): Promise<void> {
    if (!this.desiredLogLevel) {
      await this.throwError('Log Level not set. Call Util.setLogLevel(LogLevel).');
    }

    if (level < this.desiredLogLevel) {
      return;
    }

    const lineNumber = this.getLineNumber(new Error().stack ?? '');
    const timestamp = this.getWallTime(false).split('T')[1];

    if (Array.isArray(message)) {
      await Promise.all(message.map((line) => this.writeLogLine(String(line), timestamp, level, lineNumber))).catch(
        (error) => this.throwError(error)
      );
    } else {
      await this.writeLogLine(String(message), timestamp, level, lineNumber).catch((error) => this.throwError(error));
    }
  }

  public static getLogsTable(): TableOutput {
    const data = this.entries.slice();

    return {
      data,
      columns: ['timestamp', 'entryNumber', 'level', 'lineNumber', 'description'],
    };
  }

  public static mergeAndCleanArrays(strValue1: string, strValue2: string): string[] {
    const arrValue1 = strValue1?.split(',') ?? [];
    const arrValue2 = strValue2?.split(',') ?? [];

    return [...arrValue1, ...arrValue2]
      .map((value) => value.trim())
      .filter((item, index, self) => self.indexOf(item) === index)
      .filter(Boolean);
  }

  public static getWallTime(isFolderName: boolean): string {
    const now = new Date();
    let timestamp = now.toISOString();

    if (isFolderName) {
      timestamp = timestamp
        .replace(/:/g, '-')
        .replace('T', '/')
        .replace(/\.\d+Z$/, '');
    }

    return timestamp;
  }

  public static async serialize<T>(
    thisCaller: unknown,
    data: T[],
    callback: (index: number) => Promise<void>,
    index = 0
  ): Promise<void> {
    if (index >= data.length) {
      return;
    }

    try {
      await callback.apply(thisCaller, [index]);
      await this.serialize(thisCaller, data, callback, index + 1);
    } catch (err) {
      await this.throwError(err);
    }
  }

  public static clearScreen(): void {
    // Using ANSI escape codes for better cross-platform compatibility
    process.stdout.write('\n\n=== === ===\n\n');
  }

  public static consoleBold(msg: string): string {
    const BOLD = '\x1b[1m';
    const RESET = '\x1b[0m';
    return `${BOLD}${msg}${RESET}`;
  }

  public static doesLogOutputsEachStep(): boolean {
    return this.desiredLogLevel <= LogLevel.INFO;
  }

  private static async writeLogLine(
    message: string,
    timestamp: string,
    level: LogLevel,
    lineNumber: string
  ): Promise<void> {
    let messageStr: string;

    // Format message
    try {
      if (message === '') {
        messageStr = ' ';
      } else {
        messageStr = JSON.stringify(message)
          .replace(/\\t/g, ' ')
          .replace(/\\"/g, '"')
          .replace(/^"/, '')
          .replace(/"$/, '');
      }
    } catch {
      messageStr = message.toString();
    }

    // Handle counter and header
    this.counter++;
    if (this.doesLogOutputsEachStep() && this.counter === 1) {
      await Logger.root()
        .then((logger) => {
          logger.info('TimestampX # Level Line Number Description');
          logger.trace('Printing with logger');
        })
        .catch((error) => this.throwError(error));
    }

    // Process message segments
    const segments = messageStr.match(/.{1,500}/g);
    if (segments) {
      await Promise.all(
        segments.map((segment, index) => this.writeLogShortLine(segment, timestamp, level, lineNumber, index + 1))
      ).catch((error) => this.throwError(error));
    } else {
      await this.writeLogShortLine(messageStr, timestamp, level, lineNumber, 1).catch((error) =>
        this.throwError(error)
      );
    }
  }

  // tslint:disable-next-line:max-line-length

  private static async writeLogShortLine(
    message: string,
    timestamp: string,
    level: LogLevel,
    lineNumber: string,
    segmentNumber: number
  ): Promise<void> {
    const entryNumber = this.counter + (segmentNumber > 1 ? `.${segmentNumber}` : '');
    const paddedLineNumber = lineNumber.padEnd(20, ' ');
    const logPrefix = `[${lineNumber}][${timestamp}]: `;

    // Console output
    if (this.doesLogOutputsEachStep()) {
      const consoleMsg = [timestamp, entryNumber, LogLevel[level], paddedLineNumber, message].join('  ');
      const logger = await Logger.root();
      logger.info(consoleMsg);
    }

    // Internal entries list
    this.entries.push({
      description: message,
      entryNumber,
      level: LogLevel[level],
      lineNumber: paddedLineNumber,
      timestamp,
    });

    // SFDX logger
    const logger = await Logger.root();
    const logMessage = logPrefix + message;

    try {
      switch (level) {
        case LogLevel.TRACE:
        case LogLevel.DEBUG:
          logger.trace(logMessage);
          break;
        case LogLevel.INFO:
          logger.info(logMessage);
          break;
        case LogLevel.WARN:
          logger.warn(logMessage);
          break;
        case LogLevel.ERROR:
          logger.error(logMessage);
          break;
        case LogLevel.FATAL:
          logger.fatal(logMessage);
          break;
        default:
          await this.throwError(`ERROR: Level [${LogLevel[level]}] not available for logging`);
      }
    } catch (error) {
      await this.throwError(error);
    }
  }

  private static getLineNumber(stack: string): string {
    const line = stack.split('\n')[2];
    const separatorOS = line.includes('\\') ? '\\' : '/';

    return line
      .substring(line.lastIndexOf(separatorOS) + 1)
      .replace('.ts', '')
      .substring(0, line.lastIndexOf(':'));
  }
}
