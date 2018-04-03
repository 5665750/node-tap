import * as dgram from "dgram"
import * as EventEmitter from "events"
import ShadowsocksFormatter, { ShadowsocksHeaderVersion } from "./ShadowsocksFormatter"

import RC4MD5 from "./crypto/RC4MD5";

export default class ShadowsocksUdpClient extends EventEmitter {

    private socket: dgram.Socket;
    private method: any;
    private header: Buffer;

    /* support ipv4, ipv6 without domain */
    constructor(
        private host: string,
        private port: number,
        password: string, method: string,
        isIPv4: boolean,
        private targetHost: Buffer,
        private targetPort: number,
    ) {
        super();
        this.method = new RC4MD5(password);
        this.header = ShadowsocksFormatter.build({
            version: isIPv4 ? ShadowsocksHeaderVersion.IPv4 : ShadowsocksHeaderVersion.IPv6,
            address: this.targetHost,
            port: this.targetPort
        });
        this.socket = dgram.createSocket("udp4");
        this.socket.on("message", this.data.bind(this));
        this.socket.on(("error"), (err) => this.emit("error", err));
    }

    public write(data: Buffer) {
        var buffer = this.method.encryptDataWithoutStream(Buffer.concat([this.header, data]));
        this.socket.send(buffer, 0, buffer.length, this.port, this.host);
    }

    public data(data: Buffer) {
        data = this.method.decryptDataWithoutStream(data);
        var payload = ShadowsocksFormatter.format(data).payload;
        this.emit("data", payload);
    }

    public close() {
        this.socket.close();
    }
}