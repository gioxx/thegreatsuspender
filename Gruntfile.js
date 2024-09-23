module.exports = function(grunt) {
  require('time-grunt')(grunt);

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    manifest: grunt.file.readJSON('src/manifest.json'),
    config: {
      tempDir:
        grunt.cli.tasks[0] === 'tgut' ? 'build/tgut-temp/' : 'build/tgs-temp/',
      buildName:
        grunt.cli.tasks[0] === 'tgut'
          ? 'tgut-<%= manifest.version %>'
          : 'tgs-<%= manifest.version %>',
    },
    copy: {
      main: {
        files: [
          // Copy other files and directories
          { expand: true, cwd: 'src/', src: ['**'], dest: 'build/' },
          // Copy manifest.json to the root of the build directory
          { expand: true, cwd: 'src/', src: ['manifest.json'], dest: 'build/' },
          // Copy background.js to the root of the build directory
          {
            expand: true,
            cwd: 'src/js/',
            src: ['background.js'],
            dest: 'build/',
          },
        ],
      },
    },
    'string-replace': {
      debugoff: {
        files: {
          'build/': 'build/**/*',
        },
        options: {
          replacements: [
            {
              pattern: /console\.log\(.+?\);/g,
              replacement: '',
            },
          ],
        },
      },
    },
    crx: {
      public: {
        src: 'build/**/*',
        dest: 'build/zip/tgs-<%= pkg.version %>.zip',
      },
      private: {
        src: 'build/**/*',
        dest: 'build/crx/tgs-<%= pkg.version %>.crx',
        options: {
          privateKey: 'key.pem',
        },
      },
    },
    clean: {
      build: ['build/'],
    },
  });

  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-string-replace');
  grunt.loadNpmTasks('grunt-crx');
  grunt.loadNpmTasks('grunt-contrib-clean');

  grunt.registerTask('default', ['clean', 'copy', 'string-replace', 'crx']);
  grunt.registerTask('tgut', [
    'copy',
    'string-replace:debugon',
    'string-replace:localesTgut',
    'crx:public',
    'crx:private',
    'clean',
  ]);
};
