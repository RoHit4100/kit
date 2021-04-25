let {
  formatDistanceToNowStrict,
  format,
  compareAsc,
} = await npm("date-fns")

let schedule: {
  filePath: string
  date: Date
}[] = await new Promise((res, rej) => {
  let messageHandler = data => {
    if (data.channel === "SCHEDULE") {
      res(data.schedule)
      process.off("message", messageHandler)
    }
  }
  process.on("message", messageHandler)

  send("GET_SCHEDULE")
})

let choices = (
  await Promise.all(
    schedule.map(async ({ filePath, date }) => {
      let script = await cli(
        "info",
        filePath.split("/").pop()
      )
      let d = new Date(date)
      return {
        date,
        name: script?.menu || script.command,
        description: `Next ${formatDistanceToNowStrict(
          d
        )} - ${format(d, "MMM eo, h:mm:ssa ")} - ${
          script.schedule
        }`,
        value: filePath,
      }
    })
  )
).sort(({ date: a }, { date: b }) =>
  compareAsc(new Date(a), new Date(b))
)

let filePath = await arg(
  "Which script do you want to edit?",
  choices
)

edit(filePath, kenvPath())

export {}
