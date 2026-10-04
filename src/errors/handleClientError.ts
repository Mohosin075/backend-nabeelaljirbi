import { Prisma } from "@prisma/client";
import { IGenericErrorMessage } from "../interfaces/error";

const handleClientError = (error: Prisma.PrismaClientKnownRequestError) => {
  let errors: IGenericErrorMessage[] = [];
  let message = "";
  const statusCode = 400;

  if (error.code === "P2025") {
    message = (error.meta?.cause as string) || "Record not found!";
    errors = [
      {
        path: "",
        message,
      },
    ];
  } else if (error.code === "P2003") {
    message = "Foreign key constraint failed";
    errors = [
      {
        path: "",
        message,
      },
    ];
  } else if (error.code === "P2022") {
    message = `Database column missing: ${error.meta?.column || error.message}`;
    errors = [
      {
        path: String(error.meta?.column || ""),
        message,
      },
    ];
  } else {
    message = error.message || "A database error occurred";
    errors = [
      {
        path: "",
        message,
      },
    ];
  }

  return {
    statusCode,
    message,
    errorMessages: errors,
  };
};

export default handleClientError;

//"//\nInvalid `prisma.semesterRegistration.delete()` invocation:\n\n\nAn operation failed because it depends on one or more records that were required but not found. Record to delete does not exist.",
