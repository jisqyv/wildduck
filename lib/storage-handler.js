'use strict';

const GridFSBucket = require('mongodb').GridFSBucket;
const libbase64 = require('libbase64');
const libmime = require('libmime');

class StorageHandler {
    constructor(options) {
        this.database = options.database;
        this.gridfs = options.gridfs || options.database;
        this.users = options.users || options.database;
        this.bucketName = 'storage';

        this.gridstore = new GridFSBucket(this.gridfs, {
            bucketName: this.bucketName,
            chunkSizeBytes: 255 * 1024
        });
    }

    add(user, options) {
        return new Promise((resolve, reject) => {
            let filename = options.filename;
            let contentType = options.contentType;

            let filebase = 'upload-' + new Date().toISOString().substr(0, 10);
            if (!contentType && !filename) {
                filename = filebase + '.bin';
                contentType = 'application/octet-stream';
            } else if (!contentType) {
                contentType = libmime.detectMimeType(filename) || 'application/octet-stream';
            } else {
                filename = filebase + '.' + libmime.detectExtension(contentType);
            }

            let store = this.gridstore.openUploadStream(filename, {
                contentType,
                metadata: {
                    user
                }
            });

            store.on('error', err => {
                reject(err);
            });

            store.once('finish', () => {
                resolve(store.id);
            });

            if (!options.encoding) {
                // content is not encoded, pass on as is
                try {
                    store.end(options.content);
                } catch (err) {
                    reject(err);
                }
                return;
            }

            let decoder = new libbase64.Decoder();
            decoder.pipe(store);

            decoder.once('error', err => {
                // pass error forward
                store.emit('error', err);
            });

            try {
                decoder.end(options.content);
            } catch (err) {
                return reject(err);
            }
        });
    }

    get(user, file) {
        return new Promise((resolve, reject) => {
            this.gridfs.collection('storage.files').findOne(
                {
                    _id: file,
                    'metadata.user': user
                },
                (err, fileData) => {
                    if (err) {
                        return reject(err);
                    }
                    if (!fileData) {
                        let err = 'This file does not exist';
                        err.code = 'FileNotFound';
                        return reject(err);
                    }
                    let stream = this.gridstore.openDownloadStream(file);
                    let chunks = [];
                    let chunklen = 0;

                    stream.once('error', err => {
                        reject(err);
                    });

                    stream.on('readable', () => {
                        let chunk;
                        while ((chunk = stream.read()) !== null) {
                            chunks.push(chunk);
                            chunklen += chunk.length;
                        }
                    });

                    stream.once('end', () => {
                        resolve({
                            id: fileData._id,
                            filename: fileData.filename,
                            contentType: fileData.contentType,
                            size: fileData.length,
                            content: Buffer.concat(chunks, chunklen)
                        });
                    });
                }
            );
        });
    }

    delete(user, file) {
        return new Promise((resolve, reject) => {
            this.gridfs.collection('storage.files').findOne(
                {
                    _id: file,
                    'metadata.user': user
                },
                (err, fileData) => {
                    if (err) {
                        return reject(err);
                    }
                    if (!fileData) {
                        let err = 'This file does not exist';
                        err.code = 'FileNotFound';
                        return reject(err);
                    }
                    this.gridstore.delete(file, err => {
                        if (err) {
                            return reject(err);
                        }
                        return resolve();
                    });
                }
            );
        });
    }
}

module.exports = StorageHandler;
