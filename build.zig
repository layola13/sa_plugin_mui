const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const plugin_api = b.createModule(.{
        .root_source_file = b.path("src/plugin_api.zig"),
        .target = target,
        .optimize = optimize,
    });
    const root_module = b.createModule(.{
        .root_source_file = b.path("src/plugin.zig"),
        .target = target,
        .optimize = optimize,
    });
    root_module.addImport("plugin_api", plugin_api);

    const lib = b.addLibrary(.{
        .name = "mui",
        .root_module = root_module,
        .linkage = .dynamic,
    });
    b.installArtifact(lib);
    b.installFile("mui/material.sax", "share/mui/material.sax");
    b.installFile("mui/icons_material.sax", "share/mui/icons_material.sax");
    b.installFile("mui/material_kit_layout.sax", "share/mui/material_kit_layout.sax");
    b.installFile("mui/material_kit_views.sax", "share/mui/material_kit_views.sax");
    b.installFile("demos/mui_basic_inlined.sax", "share/demos/mui_basic_inlined.sax");
    b.installFile("demos/mui_all_components.sax", "share/demos/mui_all_components.sax");
    b.installFile("demos/mui_all_components_from_library.sax", "share/demos/mui_all_components_from_library.sax");
    b.installFile("demos/mui_dashboard.sax", "share/demos/mui_dashboard.sax");
    b.installFile("demos/mui_theme_lab_smoke.sax", "share/demos/mui_theme_lab_smoke.sax");
    b.installFile("demos/mui_table_pagination_repro.sax", "share/demos/mui_table_pagination_repro.sax");
    b.installFile("demos/mui_material_kit_demo.sax", "share/demos/mui_material_kit_demo.sax");
    b.installFile("demos/mui_material_kit_products.sax", "share/demos/mui_material_kit_products.sax");
    b.installFile("demos/mui_material_kit_blog.sax", "share/demos/mui_material_kit_blog.sax");
    b.installFile("demos/mui_material_kit_users.sax", "share/demos/mui_material_kit_users.sax");
    b.installFile("demos/mui_material_kit_sign_in.sax", "share/demos/mui_material_kit_sign_in.sax");
    b.installFile("demos/mui_material_kit_register.sax", "share/demos/mui_material_kit_register.sax");
    b.installFile("demos/mui_material_kit_404.sax", "share/demos/mui_material_kit_404.sax");
    b.installFile("assets/mui_dashboard.css", "share/assets/mui_dashboard.css");
    b.installFile("assets/mui_material_kit_demo.css", "share/assets/mui_material_kit_demo.css");
    b.installFile("assets/mui_demo_cover.webp", "share/assets/mui_demo_cover.webp");
    b.installFile("assets/mui_demo_inline.webp", "share/assets/mui_demo_inline.webp");
    b.installFile("assets/mui_demo_avatar.webp", "share/assets/mui_demo_avatar.webp");
    b.installFile("assets/mui_demo_avatar@2x.webp", "share/assets/mui_demo_avatar@2x.webp");
    b.installFile("data/material-components.json", "share/data/material-components.json");

    const tests = b.addTest(.{ .root_module = root_module });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run plugin tests");
    test_step.dependOn(&run_tests.step);
    test_step.dependOn(b.getInstallStep());
}
