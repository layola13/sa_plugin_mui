const std = @import("std");
const plugin_api = @import("plugin_api");

const skills = [_]plugin_api.SkillSection{
    .{
        .name = "mui",
        .summary = "SA/SAX Material UI component sources for sa_plugin_react",
        .items = &.{
            "Use mui/material.sax as the SA/SAX component source of truth",
            "Zig exports only the plugin descriptor boundary",
            "MUI component behavior belongs in SA/SAX, not Zig",
        },
    },
};

const descriptor = plugin_api.PluginDescriptor{
    .abi_version = plugin_api.abi_version,
    .descriptor_size = @as(u32, @intCast(@sizeOf(plugin_api.PluginDescriptor))),
    .name = "mui",
    .init = null,
    .prebuild = null,
    .postbuild = null,
    .handle_command = null,
    .skills_ptr = skills[0..].ptr,
    .skills_len = skills.len,
};

pub export const saasm_plugin_descriptor_v1: plugin_api.PluginDescriptor = descriptor;
pub export fn saasm_plugin_descriptor_v1_fn(out: *plugin_api.PluginDescriptor) callconv(.c) void {
    out.* = descriptor;
}

test "mui plugin exports descriptor only" {
    try std.testing.expectEqualStrings("mui", std.mem.span(descriptor.name));
    try std.testing.expectEqual(@as(usize, 1), descriptor.skills_len);
    try std.testing.expect(descriptor.handle_command == null);
}
