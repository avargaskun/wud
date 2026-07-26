# FAQ

## Core dumped on Raspberry PI
If at startup you face an issue looking like
```
#
# Fatal error in , line 0
# unreachable code
#
#
#
#FailureMessage Object: 0x7eace25c
```

Add the `--security-opt seccomp=unconfined` option to your docker command 
Example
```
docker run ... --security-opt seccomp=unconfined getwud/wud
```

## Agent Mode

### Do I need to configure registries on the Agent?
Yes. Since the Agent is responsible for checking if updates are available for the containers it watches, it needs access to the relevant registries to query for new tags.

### Can I run triggers on the Agent?
Yes, but only specific triggers like `docker` (to update containers) and `dockercompose` (to update stacks). Notification triggers (like `smtp`, `discord`, etc.) are handled by the central Controller.

### How does the Controller connect to the Agent?
The Controller acts as a client and initiates an HTTP connection (Server-Sent Events) to the Agent. The Agent does not need to know the Controller's IP, but the Controller must be able to reach the Agent via the network.

