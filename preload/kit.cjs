//cjs is required to load/assign the content of this script synchronously
//we may be able to convert this to .js if an "--import" flag is added
//https://github.com/nodejs/node/issues/35103

let context = require(`./${
  process.env?.KIT_CONTEXT === "app" ? "app" : "tty"
}.cjs`)

let attemptImport = async (path, _args) => {
  updateArgs(_args)
  try {
    //import caches loaded scripts, so we cache-bust with a uuid in case we want to load a script twice
    //must use `import` for ESM
    return await import(path + `?uuid=${uuid()}`)
  } catch (error) {
    console.warn(error.message)
    send("UPDATE_PROMPT_WARN", {
      info: error.message,
    })

    await wait(2000)
    exit(1)
  }
}

runSub = async (scriptPath, ...runArgs) => {
  return new Promise(async (res, rej) => {
    let values = []
    if (!scriptPath.includes("/")) {
      scriptPath = projectPath("scripts", scriptPath)
    }
    if (!scriptPath.startsWith(path.sep)) {
      scriptPath = projectPath(scriptPath)
    }

    if (!scriptPath.endsWith(".js"))
      scriptPath = scriptPath + ".js"

    // console.log({ scriptPath, args, argOpts, runArgs })
    let scriptArgs = [
      ...args,
      ...runArgs,
      ...argOpts,
    ].filter(arg => {
      if (typeof arg === "string") return arg.length > 0

      return arg
    })
    let child = fork(scriptPath, scriptArgs, {
      stdio: "inherit",
      execArgv: [
        "--require",
        "dotenv/config",
        "--require",
        kitPath("preload/api.cjs"),
        "--require",
        kitPath("preload/kit.cjs"),
        "--require",
        kitPath("preload/mac.cjs"),
      ],
      //Manually set node. Shouldn't have to worry about PATH
      execPath: env.KIT_NODE,
      env: {
        ...env,
        KIT_PARENT_NAME:
          env.KIT_PARENT_NAME || env.KIT_SCRIPT_NAME,
        KIT_ARGS: env.KIT_ARGS || scriptArgs.join("."),
      },
    })

    let name = process.argv[1].replace(
      projectPath() + path.sep,
      ""
    )
    let childName = scriptPath.replace(
      projectPath() + path.sep,
      ""
    )

    console.log(childName, child.pid)

    let forwardToChild = message => {
      console.log(name, "->", childName)
      child.send(message)
    }
    process.on("message", forwardToChild)

    child.on("message", message => {
      console.log(name, "<-", childName)
      send(message)
      values.push(message)
    })

    child.on("error", error => {
      console.warn(error)
      values.push(error)
      rej(values)
    })

    child.on("close", code => {
      process.off("message", forwardToChild)
      res(values)
    })
  })
}

process.on("uncaughtException", async err => {
  console.warn(`UNCAUGHT EXCEPTION: ${err}`)
  exit()
})

// TODO: Strip out minimist
args = []
updateArgs = arrayOfArgs => {
  let argv = require("minimist")(arrayOfArgs)
  args = [...args, ...argv._]
  argOpts = Object.entries(argv)
    .filter(([key]) => key != "_")
    .flatMap(([key, value]) => {
      if (typeof value === "boolean") {
        if (value) return [`--${key}`]
        if (!value) return [`--no-${key}`]
      }
      return [`--${key}`, value]
    })

  assignPropsTo(argv, arg)
}

updateArgs(process.argv.slice(2))

env = async (envKey, promptConfig = {}) => {
  if (env[envKey]) return env[envKey]

  let input = await prompt({
    message: `Set ${envKey} env to:`,
    ...promptConfig,
    cache: false,
  })

  if (input.startsWith("~"))
    input = input.replace("~", env.HOME)

  await cli("set-env-var", envKey, input)
  env[envKey] = input
  return input
}

assignPropsTo(process.env, env)

env.KIT_BIN_FILE_PATH = process.argv[1]
env.KIT_SRC_NAME = process.argv[1]
  .split(env.SKA.split(path.sep).pop())
  .pop()

env.KIT_SCRIPT_NAME = env.KIT_SRC_NAME.replace(".js", "")

kitPath = (...parts) => path.join(env.KIT, ...parts)

projectPath = (...parts) => {
  return path.join(env.SKA, ...parts.filter(Boolean))
}

libPath = (...parts) =>
  path.join(projectPath("lib"), ...parts)

kitScriptFromPath = path => {
  path = path.replace(projectPath() + "/", "")
  path = path.replace(/\.js$/, "")
  return path
}

kitFromPath = path => {
  path = path.replace(env.KIT + "/", "")
  path = path.replace(/\.js$/, "")
  return path
}

kitScript = kitScriptFromPath(env.KIT_SCRIPT_NAME)

run = async (name, ..._args) => {
  kitScript = name
  send("UPDATE_PROMPT_INFO", {
    info: `Running ${kitScript}...`,
  })
  let kitScriptPath =
    projectPath("scripts", kitScript) + ".js"

  return attemptImport(kitScriptPath, _args)
}

kit = async (scriptPath, ..._args) => {
  send("UPDATE_PROMPT_INFO", {
    info: `Running kit: ${scriptPath}...`,
  })
  let kitScriptPath = kitPath(scriptPath) + ".js"
  return await attemptImport(kitScriptPath, _args)
}

lib = async (scriptPath, ..._args) => {
  let kitScriptPath = libPath(scriptPath) + ".js"
  return await attemptImport(kitScriptPath, _args)
}

cli = async (cliPath, ..._args) => {
  send("UPDATE_PROMPT_INFO", {
    info: `Running cli: ${cliPath}...`,
  })
  let cliScriptPath = kitPath("cli/" + cliPath) + ".js"
  return await attemptImport(cliScriptPath, _args)
}

setup = async (setupPath, ..._args) => {
  send("UPDATE_PROMPT_INFO", {
    info: `Running setup: ${setupPath}...`,
  })
  let setupScriptPath =
    kitPath("setup/" + setupPath) + ".js"
  return await attemptImport(setupScriptPath, _args)
}

kitLib = async lib => {
  return await kit(`kit/${lib}`)
}

inspect = async (data, extension) => {
  let dashedDate = () =>
    new Date()
      .toISOString()
      .replace("T", "-")
      .replaceAll(":", "-")
      .split(".")[0]

  let tmpFilePath = projectPath("tmp", env.KIT_SCRIPT_NAME)
  let formattedData = data
  let tmpFullPath = path.join(
    tmpFilePath,
    `${dashedDate()}.txt`
  )
  if (typeof data === "object") {
    formattedData = JSON.stringify(data, null, "\t")
    tmpFullPath = path.join(
      tmpFilePath,
      `${dashedDate()}.json`
    )
  }

  if (extension) {
    tmpFullPath = path.join(
      tmpFilePath,
      `${dashedDate()}.${extension}`
    )
  }

  mkdir("-p", tmpFilePath)
  await writeFile(tmpFullPath, formattedData)

  await edit(tmpFullPath)
}

compileTemplate = async (template, vars) => {
  let templateContent = await readFile(
    projectPath("templates", template),
    "utf8"
  )
  let templateCompiler = compile(templateContent)
  return templateCompiler(vars)
}