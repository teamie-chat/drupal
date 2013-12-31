<?php

/**
 * Admin form callback.
 */
function t_chat_admin() {
  $form['config'] = array(
    '#type' => 'vertical_tabs',
    '#tree' => FALSE
  );

  $form['basic'] = array(
    '#type' => 'fieldset',
    '#title' => t('Basic'),
    '#tree' => FALSE,
    '#group' => 'config',
  );

  $form['addons'] = array(
    '#type' => 'fieldset',
    '#title' => t('Addons'),
    '#tree' => FALSE,
    '#group' => 'config',
  );

  $form['basic']['t_chat_server_url'] = array(
    '#type' => 'textfield',
    '#title' => t('Chat Server URL'),
    '#description' => t('The absolute URL to the running nodeJS server application. Eg. http://chat.example.com:8080'),
    '#default_value' => variable_get('t_chat_server_url', NULL)
  );

  $form['basic']['ping'] = array(
    '#type' => 'submit',
    '#value' => t('Ping server'),
    '#states' => array(
      'enabled' => array(
        'input[name="t_chat_server_url"]' => array('filled' => TRUE)
      )
    ),
    '#prefix' => '<div class="form-group clearfix">',
    '#suffix' => '</div>',
    '#validate' => array('t_chat_admin_ping_server')
  );

  $form['basic']['t_chat_api_secret'] = array(
    '#type' => 'textfield',
    '#title' => t('API token'),
    '#description' => t('This token is used to authenticate backend communication between this Drupal
      site and the nodeJS server application.'),
    '#default_value' => drupal_get_hash_salt(),
    '#disabled' => 1
  );

  $form['basic']['t_chat_redis_prefix'] = array(
    '#type' => 'textfield',
    '#title' => t('Redis key prefix'),
    '#description' => t('The prefix used for all the keys in the Redis datastore that the server writes to.
    <strong class="error text-error">Note: While this is required right now - as the client has no real need to know this
    value, this setting will be deprecated soon.</strong>'),
    '#default_value' => variable_get('t_chat_redis_prefix', NULL)
  );

  $form['basic']['t_chat_use_cdn'] = array(
    '#type' => 'checkbox',
    '#title' => t('Use libraries from a CDN'),
    '#description' => t('This module requires several vendor Javascript libraries such as AngularJS, AngularJS Sanitize,
      jQuery Chosen, jQuery Timeago and SocketIO Client. If this option is not checked, this module expects that these libraries
      have been manually installed on this site by hand. If checked, these libraries will be pulled from CloudFare\'s CDN. Check !cdnjs_link
      for more.', array('!cdnjs_link' => l('http://cdnjs.com', 'http://cdnjs.com'))),
    '#default_value' => variable_get('t_chat_use_cdn', 0)
  );

  $experimental_tag =
      ' <strong class="error text-error">WARNING: Note that this feature is experimental.</strong> ';

  $form['addons']['t_chat_alert_sounds'] = array(
    '#type' => 'checkbox',
    '#title' => t('Sound Alert'),
    '#description' => $experimental_tag . t('Play a short sound to highlight new message arrival to the user. If checked, at this point in time, the user will
    not be able to undo this. So, use with caution.'),
    '#default_value' => variable_get('t_chat_alert_sounds', 0)
  );

  $form['addons']['t_chat_escapehtml'] = array(
    '#type' => 'checkbox',
    '#title' => t('Escape HTML'),
    '#description' => t('Rewrite HTML tags in a user\'s chat message before it is rendered in another
      user\'s chat tab.'),
    '#default_value' => variable_get('t_chat_escapehtml', 1)
  );

  $form['addons']['t_chat_linkify'] = array(
    '#type' => 'checkbox',
    '#title' => t('Linkify'),
    '#description' => t('Automatically convert full URLs to links that can be clicked-through directly from
      chat messages.'),
    '#default_value' => variable_get('t_chat_linkify', 1)
  );

  $form['addons']['t_chat_emoticonize'] = array(
    '#type' => 'checkbox',
    '#title' => t('Emoticonize'),
    '#description' => $experimental_tag . t('Convert text-based emoticons to images'),
    '#default_value' => variable_get('t_chat_emoticonize', 0)
  );

  return system_settings_form($form);
}

/**
 * Callback that pings the Chat server.
 */
function t_chat_admin_ping_server($form, &$form_state) {
  $server_url = $form_state['values']['t_chat_server_url'];
  if (valid_url($server_url)) {
    $server_url = rtrim($server_url, '/');
    $response = drupal_http_request($server_url . '/ping', array(
      'method' => 'POST',
      'data' => http_build_query(array('token' => drupal_get_hash_salt())),
      'headers' => array(
        'Content-Type' => 'application/x-www-form-urlencoded'
      )
    ));
    $opts = array('!url' => '<code>' . $server_url . '</code>');
    if ($response->code == 200) {
      drupal_set_message(t('The chat server seems to be up and running at !url right now.', $opts), 'status');
    }
    elseif ($response->code == 401) {
      drupal_set_message(t('Your chat server seems to be up but the ping was unauthorized. Did you configure the
        chat server with the right API token as shown below on this page?'), 'warning');
    }
    else {
      form_set_error('t_chat_server_url', t('We could be wrong but there is a good chance that the server app is not
        running at !url right now.', $opts)
      );
    }
  }
  else {
    drupal_set_message(t('The chat server URL is not a valid one.'), 'error');
  }
}