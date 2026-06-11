const std = @import("std");

pub const abi_version: u32 = 1;

pub const SkillSection = struct {
    name: []const u8,
    summary: []const u8,
    items: []const []const u8,
};

pub const Context = struct {
    allocator: std.mem.Allocator,
    host_version: ?[*]const u8 = null,
    log: ?*const anyopaque = null,
    log_ctx: ?*anyopaque = null,
    json_mode: bool = false,
};

pub const StreamWriteAllFn = *const fn (ctx: ?*anyopaque, bytes: [*]const u8, len: usize) callconv(.c) u32;

pub const HostStream = extern struct {
    ctx: ?*anyopaque,
    write_all: ?StreamWriteAllFn,
};

pub const PluginDescriptor = extern struct {
    abi_version: u32,
    descriptor_size: u32,
    name: [*:0]const u8,
    init: ?*const fn (ctx: *const Context) callconv(.c) u32,
    prebuild: ?*const fn (ctx: *const Context, compile_options: ?*anyopaque) callconv(.c) u32,
    postbuild: ?*const fn (ctx: *const Context) callconv(.c) u32,
    handle_command: ?*const fn (ctx: *const Context, argv: [*]const [*:0]const u8, argv_len: usize, stdout: HostStream, stderr: HostStream, out_code: *u8) callconv(.c) u32,
    skills_ptr: [*]const SkillSection,
    skills_len: usize,
};
