# config valid only for current version of Capistrano 
lock '3.7.2'

set :application, 'adaptup'
set :repo_url, 'git@github.com:DukeMobileTech/AdaptUP.git'
set :branch, 'develop'
set :scm, :git
set :pty, true
set :linked_files, ['config/settings.yml']
set :linked_dirs, %w(data tmp log)
set :keep_releases, 5

namespace :deploy do
  desc 'Restart Application'
  task :restart do
    desc 'restart phusion passenger'
    on roles(:app), in: :sequence, wait: 5 do
      execute :touch, current_path.join('tmp/restart.txt')
    end  
  end
  
  before 'deploy:updated', 'npm:install'
  after :publishing, :restart
end
