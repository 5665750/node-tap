const native = require("../index.js");

import * as fs from "fs"
import PacketUtils from "./PacketUtils"
import { promisify } from "util"
import * as cprocess from "child_process"
import * as NativeTypes from "./NativeTypes"
import tcp from "./tcp"
import ArpPacketFormatter from "./formatters/ArpPacketFormatter"
import { setTimeout } from "timers";

const FACILITY_NULL = 0;
const ERROR_IO_PENDING = 997;

const TAP_IOCTL_GET_MTU = CTL_CODE(0x00000022, 3, 0, 0);
const TAP_IOCTL_SET_MEDIA_STATUS = CTL_CODE(0x00000022, 6, 0, 0);
const TAP_WIN_IOCTL_CONFIG_DHCP_MASQ = CTL_CODE(0x00000022, 7, 0, 0);
const TAP_WIN_IOCTL_CONFIG_DHCP_SET_OPT = CTL_CODE(0x00000022, 9, 0, 0);
const TAP_IOCTL_CONFIG_TUN = CTL_CODE(0x00000022, 10, 0, 0);

const MIB_IPROUTE_TYPE_OTHER = 1;
const MIB_IPROUTE_TYPE_INVALID = 2;
const MIB_IPROUTE_TYPE_DIRECT = 3;
const MIB_IPROUTE_TYPE_INDIRECT = 4;

const MIB_IPPROTO_OTHER = 1;
const MIB_IPPROTO_LOCAL = 2;
const MIB_IPPROTO_NETMGMT = 3;
const MIB_IPPROTO_ICMP = 4;
const MIB_IPPROTO_EGP = 5;
const MIB_IPPROTO_GGP = 6;
const MIB_IPPROTO_HELLO = 7;
const MIB_IPPROTO_RIP = 8;
const MIB_IPPROTO_IS_IS = 9;
const MIB_IPPROTO_ES_IS = 10;
const MIB_IPPROTO_CISCO = 11;
const MIB_IPPROTO_BBN = 12;
const MIB_IPPROTO_OSPF = 13;
const MIB_IPPROTO_BGP = 14;
const MIB_IPPROTO_NT_AUTOSTATIC = 10002;
const MIB_IPPROTO_NT_STATIC = 10006;
const MIB_IPPROTO_NT_STATIC_NON_DOD = 10007;

const TRUE = new Buffer([0x01, 0x00, 0x00, 0x00]);
const FALSE = new Buffer([0x00, 0x00, 0x00, 0x00]);

const IPADDRESS = "10.198.75.60";
const NETMASK = "255.255.255.0";
const GATEWAY = "10.198.75.61";

function CTL_CODE(deviceType, func, method, access) {
    return ((deviceType) << 16) | ((access) << 14) | ((func) << 2) | (method)
}

async function main() {
    var deviceInfo: NativeTypes.DeviceInfo = <NativeTypes.DeviceInfo>await promisify(native.N_GetDeviceInfo)();

    var deviceHandle: number = native.N_CreateDeviceFile(deviceInfo.instanceId);
    await promisify(native.N_DeviceControl)(deviceHandle, TAP_IOCTL_SET_MEDIA_STATUS, TRUE, 32);

    var deafultGateway: string = (<Array<NativeTypes.IpforwardEntry>>native.N_GetIpforwardEntry())[0].nextHop;

    var initCommands: Array<Array<string>> = [
        ["netsh", "interface", "ipv4", "set", "interface", `${deviceInfo.name}`, "metric=1"],
        ["netsh", "interface", "ipv6", "set", "interface", `${deviceInfo.name}`, "metric=1"],
        ["netsh", "interface", "ip", "set", "address", `name=${deviceInfo.name}`, "static", IPADDRESS, NETMASK, GATEWAY],
        ["route", "delete", "0.0.0.0", GATEWAY],
        ["route", "add", "10.1.1.11", "mask", "255.255.255.255", deafultGateway],
        ["route", "add", "114.114.114.114", "mask", "255.255.255.255", deafultGateway],
        ["route", "add", "114.114.115.115", "mask", "255.255.255.255", deafultGateway],
    ];
    initCommands.forEach(command => {
        console.log(command.join(" "));
        var result = cprocess.spawnSync(command[0], command.slice(1), { timeout: 1000 * 5 });
        var output = result.stdout.toString().trim();
        var errorOutput = result.stderr.toString().trim();
    });

    {
        let code: number = native.N_CreateIpforwardEntry({
            dwForwardDest: "0.0.0.0",
            dwForwardMask: "0.0.0.0",
            dwForwardPolicy: 0,
            dwForwardNextHop: GATEWAY,
            dwForwardIfIndex: deviceInfo.index,
            dwForwardType: MIB_IPROUTE_TYPE_INDIRECT,
            dwForwardProto: MIB_IPPROTO_NETMGMT,
            dwForwardAge: 0,
            dwForwardNextHopAS: 0,
            dwForwardMetric1: 2,
        })
        console.log("create ip forward entry result:", code == 0 ? "SUCCESS" : `ERROR code: ${code}`);
    }

    var rwProcess = new native.RwEventProcess(deviceHandle);
    var read = function () {
        return new Promise((resolve, reject) => {
            rwProcess.read(function (err, data) {
                err ? reject(err) : resolve(data);
            });
        });
    }

    var write = function (data: Buffer) {
        rwProcess.writeSync(data);
    }

    async function loop() {
        var data = await read();

        if (PacketUtils.isIPv4(data)) {

            if (PacketUtils.isTCP(data)) {
                tcp(<Buffer>data, write);
                return setImmediate(loop);
            }

            return setImmediate(loop);
        }

        if (PacketUtils.isARP(data)) {
            var arpPacket = ArpPacketFormatter.format(<Buffer>data);
            if (
                (PacketUtils.ipAddressToString(arpPacket.senderIpAdress) != "10.198.75.60") ||
                (PacketUtils.ipAddressToString(arpPacket.targetIpAddeess) != "10.198.75.61")
            ) return setImmediate(loop);

            write(ArpPacketFormatter.build(arpPacket.destinaltionAddress,
                new Buffer([0x00, 0xff, 0xb9, 0x5a, 0xd2, 0xd5]),
                PacketUtils.stringToIpAddress(GATEWAY),
                deviceInfo.address,
                PacketUtils.stringToIpAddress(IPADDRESS)));
            return setImmediate(loop);
        }

        return setImmediate(loop);
    }
    loop();
}

process.on("unhandledRejection", function (reason, p) {
    console.log("Unhandled Rejection at: Promise", p, "reason:", reason);
});

main();
